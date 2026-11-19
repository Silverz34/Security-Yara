const MAX_BYTES = 25 * 1024 * 1024; // tamaño máximo a escanear (25 MB)
const ESPERA_NOMBRE_MS = 500;       // tiempo máximo para esperar el filename final
const TIMEOUT_DESCARGA_MS = 60000;  // tiempo máximo para pedir el archivo a su sitio de origen
const TIMEOUT_API_MS = 20000;       // tiempo máximo de cada llamada a la API
const API_URL = "http://127.0.0.1:8000";

const descargas = new Map();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const BOTONES = {
  sospechoso: ["aceptar", "eliminar"],
  error: ["aceptar", "eliminar"],
  excede_tamano: ["aceptar", "eliminar"],
  no_escaneable: ["aceptar", "eliminar"],
  peligroso: ["entendido"],
};

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
  let nombreUrl = "";
  try {
    nombreUrl = nombreBase(new URL(url).pathname);
  } catch { }
  const nombre = (nombreBase(d.filename) || nombreUrl || "archivo").slice(0, 120);
  return { filename: nombre, extension: extensionDe(nombre), mime: d.mime, source_domain: dominioDe(url), scan_mode: "degradado" };
}

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

async function borrarPeligroso(id, ctx) {
  const antes = await estado(id);
  try {
    if (antes && antes.state === "in_progress") {
      await chrome.downloads.cancel(id);
      log(id, "cancel OK (descarga en curso descartada)");
      return true;
    }
    if (antes && antes.state === "complete") {
      await chrome.downloads.removeFile(id);
      log(id, "removeFile OK");
      return true;
    }
    log(id, "estado no esperado, no se borró", antes);
  } catch (e) {
    log(id, "NO SE PUDO BORRAR", { mensaje: e.message });
  }
  return false;
}

async function aplicarVeredicto(id, r, ctx) {
  log(id, "veredicto", { veredicto: r.verdict });
  if (r.verdict === "peligroso") {
    if (await borrarPeligroso(id, ctx)) await mostrarAviso(id, r, ctx);
  } else if (["sospechoso", "error", "excede_tamano"].includes(r.verdict)) {
    await mostrarAviso(id, r, ctx);
  }
}

async function mostrarAviso(id, r, ctx) {
  const clave = `pend:${id}`;
  const existente = await chrome.storage.session.get(clave);
  if (existente[clave]) return;
  const pendiente = {
    id,
    verdict: r.verdict,
    matches: r.matches || [],
    filename: ctx.filename,
    botones: BOTONES[r.verdict],
  };
  await chrome.storage.session.set({ [clave]: pendiente });
  const ventana = await chrome.windows.create({
    url: chrome.runtime.getURL(`aviso.html?id=${id}`),
    type: "popup",
    width: 480,
    height: 600,
  });
  await chrome.storage.session.set({ [clave]: { ...pendiente, windowId: ventana.id } });
}

// accion: "aceptar" | "eliminar" | "entendido" | "cerrar" (cerrar la ventana con la X)
async function aplicarDecision(id, accion) {
  const clave = `pend:${id}`;
  const { [clave]: pend } = await chrome.storage.session.get(clave);
  if (!pend) return;
  await chrome.storage.session.remove(clave);
  if (pend.windowId) chrome.windows.remove(pend.windowId).catch(() => {});
  log(id, "decisión del usuario", { accion });

  const e = await estado(id);
  if (!e) return;
  try {
    if (accion === "aceptar") {
      if (e.state === "in_progress" && e.paused) await chrome.downloads.resume(id);
    } else if (accion === "eliminar" || (accion === "cerrar" && e.state === "in_progress" && e.paused)) {
      if (e.state === "complete") await chrome.downloads.removeFile(id);
      else await chrome.downloads.cancel(id);
    }
  } catch (err) {
    log(id, "no se pudo aplicar la decisión", { mensaje: err.message });
  }
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Pide el archivo, consulta la caché de la API y, si no la conoce, lo sube para escanearlo
async function escanearConApi(url, ctx) {
  const resp = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS) });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  if (Number(resp.headers.get("content-length")) > MAX_BYTES) return { verdict: "excede_tamano" };
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return { verdict: "excede_tamano" };

  const hash = await sha256Hex(buffer);
  const consulta = new URLSearchParams({
    filename: ctx.filename,
    mime: ctx.mime || "",
    source_domain: ctx.source_domain,
    scan_mode: ctx.scan_mode || "principal",
  });
  const c = await fetch(`${API_URL}/verdicts/${hash}?${consulta}`, { signal: AbortSignal.timeout(TIMEOUT_API_MS) });
  if (c.ok) return c.json();
  if (c.status !== 404) throw new Error(`API ${c.status}`);

  const form = new FormData();
  form.append("file", new Blob([buffer]), ctx.filename);
  form.append("sha256", hash);
  form.append("filename", ctx.filename);
  form.append("extension", ctx.extension);
  form.append("mime", ctx.mime || "");
  form.append("source_domain", ctx.source_domain);
  form.append("scan_mode", ctx.scan_mode || "principal");

  const r = await fetch(`${API_URL}/scan`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_API_MS) });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

// Un reintento; si vuelve a fallar, el veredicto es "error"
async function escanear(id, url, ctx) {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      return await escanearConApi(url, ctx);
    } catch (e) {
      log(id, `escaneo falló (intento ${intento})`, { mensaje: e.message });
    }
  }
  return { verdict: "error" };
}

// Mantiene vivo el service worker mientras dura la promesa
async function conPulso(promesa) {
  const pulso = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    return await promesa;
  } finally {
    clearInterval(pulso);
  }
}

async function escanearYAplicar(id, url, ctx) {
  const r = await conPulso(escanear(id, url, ctx));
  log(id, "respuesta de la API", r);
  await aplicarVeredicto(id, r, ctx);
}

async function procesarDescarga(item) {
  const id = item.id;
  const url = item.finalUrl || item.url || "";
  if (item.byExtensionId) return;
  if (item.startTime && Date.now() - new Date(item.startTime).getTime() > 15000) return;
  const esBlobData = /^(blob|data):/i.test(url);
  if (!esBlobData && !/^https?:\/\//i.test(url)) return;

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
  if (esBlobData) {
    d.modo = "no_escaneable_blob_data";
    log(id, "NO ESCANEABLE: URL blob:/data:. No se pausa; la descarga sigue normal");
    await Promise.race([d.nombreListo, esperar(ESPERA_NOMBRE_MS)]);
    await mostrarAviso(id, { verdict: "no_escaneable", matches: [] }, { filename: nombreBase(d.filename) || "archivo" });
    return;
  }

  // el tamaño ya se conoce en onCreated -> si excede el máximo, ni se pausa
  if (item.totalBytes > MAX_BYTES) {
    d.modo = "excede_tamano";
    log(id, "EXCEDE EL MÁXIMO: no se pausa ni se escanea", {
      totalBytes: item.totalBytes,
      maxBytes: MAX_BYTES,
    });
    const filename = nombreBase(d.filename) || nombreBase(new URL(item.url).pathname);
    await mostrarAviso(id, { verdict: "excede_tamano", matches: [] }, { filename });
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

  // pause() no falla aunque llegue tarde; se revisa el estado real
  const e1 = await estado(id);
  log(id, "estado tras pausar", e1);
  const llegoTarde =
    !e1 ||
    e1.state !== "in_progress" ||
    (e1.totalBytes > 0 && e1.bytesReceived >= e1.totalBytes);

  if (!pausada || llegoTarde) {
    d.modo = "degradado";
    log(id, "MODO DEGRADADO: la pausa llegó tarde");
    await Promise.race([d.nombreListo, esperar(ESPERA_NOMBRE_MS)]);
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
    scan_mode: "principal",
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
    // La pausa no retuvo la descarga: se trata como modo degradado
    await escanearYAplicar(id, item.url, contextoDe(item.url, d));
    return;
  }
  log(id, "respuesta de la API", resultado);
  const veredicto = resultado.verdict;
  await aplicarVeredicto(id, resultado, contexto);
  if (["peligroso", "sospechoso", "error", "excede_tamano"].includes(veredicto)) return; // espera la decisión o no se reanuda
  const e2 = await estado(id);
  log(id, "estado antes de reanudar", e2);
  try {
    await chrome.downloads.resume(id);
    log(id, "resume OK");
  } catch (e) {
    log(id, "resume FALLÓ", { mensaje: e.message });
  }
}

// Red de seguridad: ante un fallo inesperado, el usuario ve el aviso de "no se pudo escanear"
async function fallar(item) {
  const d = descargas.get(item.id);
  const filename = (d && nombreBase(d.filename)) || nombreBase(item.url || "") || "archivo";
  try {
    await mostrarAviso(item.id, { verdict: "error", matches: [] }, { filename });
  } catch (e) {
    console.error(`[#${item.id}] no se pudo mostrar el aviso de error`, e);
  }
}

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    await procesarDescarga(item);
  } catch (e) {
    console.error(`[#${item.id}] fallo inesperado`, e);
    await fallar(item);
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "decision") aplicarDecision(msg.id, msg.accion);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const todo = await chrome.storage.session.get(null);
  for (const [clave, pend] of Object.entries(todo)) {
    if (clave.startsWith("pend:") && pend.windowId === windowId) aplicarDecision(pend.id, "cerrar");
  }
});
