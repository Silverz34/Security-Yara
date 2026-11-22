// Ventanas de aviso y decisiones del usuario.
import { log } from "./registro.js";
import { estado } from "./util.js";

const ACCIONES = ["aceptar", "eliminar", "entendido", "cerrar"];

const BOTONES = {
  sospechoso: ["aceptar", "eliminar"],
  error: ["aceptar", "eliminar"],
  excede_tamano: ["aceptar", "eliminar"],
  no_escaneable: ["aceptar", "eliminar"],
  peligroso: ["entendido"],
};

async function borrarPeligroso(id) {
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

export async function aplicarVeredicto(id, r, ctx) {
  log(id, "veredicto", { veredicto: r.verdict });
  if (r.verdict === "peligroso") {
    if (await borrarPeligroso(id)) await mostrarAviso(id, r, ctx);
  } else if (["sospechoso", "error", "excede_tamano"].includes(r.verdict)) {
    await mostrarAviso(id, r, ctx);
  }
}

export async function mostrarAviso(id, r, ctx) {
  const clave = `pend:${id}`;
  const existente = await chrome.storage.session.get(clave);
  if (existente[clave]) return;
  const pendiente = {
    id,
    verdict: r.verdict,
    matches: r.matches || [],
    filename: ctx.filename,
    botones: BOTONES[r.verdict] ?? BOTONES.error,
  };
  await chrome.storage.session.set({ [clave]: pendiente });
  const ventana = await chrome.windows.create({
    url: chrome.runtime.getURL(`src/aviso/aviso.html?id=${id}`),
    type: "popup",
    width: 480,
    height: 600,
  });
  await chrome.storage.session.set({ [clave]: { ...pendiente, windowId: ventana.id } });
}

// accion: "aceptar" | "eliminar" | "entendido" | "cerrar" (cerrar la ventana con la X)
export async function aplicarDecision(id, accion) {
  if (!Number.isInteger(id) || !ACCIONES.includes(accion)) return;
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

// Cerrar la ventana con la X cuenta como decisión "cerrar"
export async function alCerrarVentana(windowId) {
  const todo = await chrome.storage.session.get(null);
  for (const [clave, pend] of Object.entries(todo)) {
    if (clave.startsWith("pend:") && pend.windowId === windowId) aplicarDecision(pend.id, "cerrar");
  }
}
