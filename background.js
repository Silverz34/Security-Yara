
const MAX_BYTES = 25 * 1024 * 1024; // tamaño máximo a escanear (25 MB)
const ESPERA_NOMBRE_MS = 500;    // tiempo máximo para esperar el filename final
const ESPERA_FIN_MS = 30000;     // tiempo máximo para esperar que termine una descarga tardía

const descargas = new Map();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const API_URL = "http://127.0.0.1:8000"
const SOLO_DOMINIO_PRUEBA = ["localhost", "127.0.0.1"];



function log(id, mensaje, datos) {
  const d = descargas.get(id);
  const ms = d ? Date.now() - d.inicio : 0;
  console.log(`[#${id} +${ms}ms] ${mensaje}` + (datos ? " " + JSON.stringify(datos) : ""));
}
const nombreBase = (ruta) => (ruta || "").split(/[\\/]/).pop();

function extensionDe(nombre) {
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(i + 1).toLowerCase() : "";
}

function dominioDe(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}



function contextoDe(url, d) {
  const nombre = nombreBase(d.filename) || nombreBase(new URL(url).pathname);
  return { filename: nombre, extension: extensionDe(nombre), mime: d.mime, source_domain: dominioDe(url) };
}

async function aplicarVeredicto(id, veredicto, ctx) {
  log(id, "veredicto ", { veredicto });
  if (veredicto !== "peligroso") return;
  if (!SOLO_DOMINIO_PRUEBA.includes(ctx.source_domain)) {
    log(id, "PELIGROSO, pero el dominio no está en la lista de prueba: NO se borra", { dominio: ctx.source_domain });
    return;
  }
  const antes = await estado(id);
  try {
    if (antes && antes.state === "in_progress") {
      await chrome.downloads.cancel(id);
      log(id, "cancel OK (descarga en curso descartada)");
    } else if (antes && antes.state === "complete") {
      await chrome.downloads.removeFile(id);
      log(id, "removeFile OK");
    } else {
      log(id, "estado no esperado, no se borró", antes);
    }
  } catch (e) {
    log(id, "NO SE PUDO BORRAR", { mensaje: e.message });
  }
  log(id, "estado tras el borrado", await estado(id));
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


async function escanearConApi(url, ctx) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  if (Number(resp.headers.get("content-length")) > MAX_BYTES) return { verdict: "excede_tamano" };
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return { verdict: "excede_tamano" };

  const form = new FormData();
  form.append("file", new Blob([buffer]), ctx.filename);
  form.append("sha256", await sha256Hex(buffer));
  form.append("filename", ctx.filename);
  form.append("extension", ctx.extension);
  form.append("mime", ctx.mime || "");
  form.append("source_domain", ctx.source_domain);

  const r = await fetch(`${API_URL}/scan`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

//reintento en casi de falle una vez el escaneo
async function escanear(id, url, ctx) {
  for (let intento = 1; intento <= 2; intento++){
    try {
      return await escanearConApi(url, ctx);
    } catch (e) {
      log(id, `escaneo fallo(intento ${intento})`, {mensaje: e.message});
    }
  }
  return { veredict: "error" };
}


async function conPulso(promesa) {
  const pulso = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    return await promesa;
  } finally{
   clearInterval(pulso);

  }
}

async function escanearYAplicar(id, url, ctx) {
  const r = await conPulso(escanear(id, url, ctx));
  log(id, "respuesta de la API", r);
  await aplicarVeredicto(id, r.verdict, ctx);
}


// constantes para el plan B


async function estado(id) {
  const [d] = await chrome.downloads.search({ id });
  if (!d) return null;
  return {
    state: d.state,
    paused: d.paused,
    bytesReceived: d.bytesReceived,
    totalBytes: d.totalBytes,
    canResume: d.canResume,
    error: d.error,
  };
}


chrome.downloads.onCreated.addListener(async (item) => {
  const id = item.id;
  const d = {
    inicio: Date.now(),
    modo: "principal",
    reteniendo: false,
    mime: item.mime,
    filename: item.filename || "",
    nombreListo: null,
    resolverNombre: null,
    terminada: null,
    resolverTerminada: null,
  };
  d.nombreListo = new Promise((r) => (d.resolverNombre = r));
  d.terminada = new Promise((r) => (d.resolverTerminada = r));
  if (d.filename) d.resolverNombre();
  descargas.set(id, d);

  log(id, "onCreated", {
    url: item.url,
    mime: item.mime,
    state: item.state,
    totalBytes: item.totalBytes,
  });

  // blob: y data: no se pueden volver a pedir con fetch -> no escaneables
  if (/^(blob|data):/i.test(item.url)) {
    d.modo = "no_escaneable_blob_data";
    log(id, "NO ESCANEABLE: URL blob:/data:. No se pausa; la descarga sigue normal");
    return;
  }

  // el tamaño ya se conoce en onCreated -> si excede el máximo, ni se pausa
  if (item.totalBytes > MAX_BYTES) {
    d.modo = "excede_tamano";
    log(id, "EXCEDE EL MÁXIMO: no se pausa; en la versión real se avisaría al usuario", {
      totalBytes: item.totalBytes,
      maxBytes: MAX_BYTES,
    });
    return;
  }

  // Pausar lo antes posible
  let pausada = false;
  try {
    await chrome.downloads.pause(id);
    pausada = true;
  } catch (e) {
    log(id, "pause lanzó error", { mensaje: e.message });
  }

  //pause() no falla aunque llegue tarde; se revisa el estado real
  const e1 = await estado(id);
  log(id, "estado tras pausar", e1);
  const llegoTarde =
    !e1 ||
    e1.state !== "in_progress" ||
    (e1.totalBytes > 0 && e1.bytesReceived >= e1.totalBytes);

  if (!pausada || llegoTarde) {
    d.modo = "degradado";
    log(id, "MODO DEGRADADO: la pausa llegó tarde. Se espera a que termine");
    await Promise.race([d.terminada, esperar(ESPERA_FIN_MS)]);
    await escanearYAplicar(id, item.url, contextoDe(item.url, d));
    return;
  }

  // esperar el filename (y mime) finales, que llegan unos ms después de onCreated
  await Promise.race([d.nombreListo, esperar(ESPERA_NOMBRE_MS)]);
  const nombre = nombreBase(d.filename) || nombreBase(new URL(item.url).pathname);
  const contexto = {
    filename: nombre,
    extension: extensionDe(nombre),
    mime: d.mime,
    source_domain: dominioDe(item.url),
    fuente_nombre: d.filename ? "chrome" : "url",
  };
  log(id, "contexto que se mandaría a la API", contexto);


  let resultado = null;
  d.reteniendo = true;
  const terminoAntes = await Promise.race([
      conPulso(escanear(id, item.url, contexto)).then((r) => {
        resultado = r;
        return false;
      }),
      d.terminada.then(() => true),
  ]);
  d.reteniendo = false;

  if (terminoAntes) {
    // La pausa no retuvo la descarga (por ejemplo, salió del caché): se trata como modo degradado
    await escanearYAplicar(id, item.url, contextoDe(item.url, d));
    return;
  }
  log(id, "respuesta de la API", resultado);
  const veredicto = resultado.verdict;
  await aplicarVeredicto(id, veredicto, contexto);
  if (veredicto === "peligroso") return; // no se reanuda
  const e2 = await estado(id);
  log(id, "estado antes de reanudar", e2);
  try {
    await chrome.downloads.resume(id);
    log(id, "resume OK");
  } catch (e) {
    log(id, "resume FALLÓ", { mensaje: e.message });
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  const id = delta.id;
  const d = descargas.get(id);
  const cambios = {};
  for (const [campo, valor] of Object.entries(delta)) {
    if (campo === "id" || campo === "canResume") continue;
    cambios[campo] = valor.current;
  }

  if (d) {
    if (delta.filename && delta.filename.current) {
      d.filename = delta.filename.current;
      d.resolverNombre();
    }
    if (delta.mime && delta.mime.current) d.mime = delta.mime.current;
  }
  if (Object.keys(cambios).length) log(id, "onChanged", cambios);

  const fin = delta.state && ["complete", "interrupted"].includes(delta.state.current);
  if (d && fin) {
    if (d.modo === "principal" && d.reteniendo) d.modo = "degradado_tardio";
    d.resolverTerminada();
    log(id, "RESUMEN", {
      modo: d.modo,
      estado_final: delta.state.current,
      error: delta.error ? delta.error.current : null,
      duracion_ms: Date.now() - d.inicio,
    });
  }
});
