// Notificaciones nativas y decisiones del usuario.
import { MAX_BYTES } from "../shared/config.js";
import { log } from "./registro.js";
import { estado } from "./util.js";

const PREFIJO_NOTIF = "sy_aviso_";
const ACCIONES = ["aceptar", "eliminar", "entendido", "cerrar"];

const BOTONES = {
  sospechoso: ["aceptar", "eliminar"],
  error: ["aceptar", "eliminar"],
  excede_tamano: ["aceptar", "eliminar"],
  no_escaneable: ["aceptar", "eliminar"],
  peligroso: ["entendido"],
};

const ETIQUETAS = {
  aceptar: "Aceptar",
  eliminar: "Eliminar",
  entendido: "Entendido",
};

function acortar(texto, max = 36) {
  if (!texto || texto.length <= max) return texto || "archivo";
  return `${texto.slice(0, max - 1)}…`;
}

function construirNotificacion(verdict, filename, matches = []) {
  const archivo = acortar(filename);
  const hallazgos = matches
    .filter((x) => x.severity !== "low" && x.title_es)
    .map((x) => x.title_es);
  const detalleReglas = hallazgos.length ? ` (${hallazgos.slice(0, 2).join(", ")})` : "";

  switch (verdict) {
    case "sospechoso":
      return {
        title: "Archivo sospechoso",
        message: `${archivo}: señales de riesgo${detalleReglas}. Elige si deseas aceptarlo o eliminarlo.`,
      };
    case "peligroso":
      return {
        title: "Archivo peligroso eliminado",
        message: `${archivo}: amenaza detectada${detalleReglas}. SecureYara lo eliminó para protegerte.`,
      };
    case "excede_tamano":
      return {
        title: "Archivo demasiado grande",
        message: `${archivo} supera el límite de ${MAX_BYTES / 1024 / 1024} MB y no se analizó. No sabemos si es seguro.`,
      };
    case "no_escaneable":
      return {
        title: "Descarga no escaneable",
        message: `${archivo} proviene de blob:/data: y no puede re-descargarse para análisis. No sabemos si es seguro.`,
      };
    case "error":
    default:
      return {
        title: "No se pudo escanear",
        message: `Falló el análisis de ${archivo} tras reintentar. No sabemos si es seguro.`,
      };
  }
}

function idDesdeNotif(notifId) {
  if (typeof notifId !== "string" || !notifId.startsWith(PREFIJO_NOTIF)) return null;
  const id = Number(notifId.slice(PREFIJO_NOTIF.length));
  return Number.isInteger(id) ? id : null;
}

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

  const botones = BOTONES[r.verdict] ?? BOTONES.error;
  const pendiente = {
    id,
    verdict: r.verdict,
    matches: r.matches || [],
    filename: ctx.filename,
    botones,
  };
  await chrome.storage.session.set({ [clave]: pendiente });

  const { title, message } = construirNotificacion(r.verdict, ctx.filename, r.matches);
  await chrome.notifications.create(`${PREFIJO_NOTIF}${id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("images/ico_32.png"),
    title,
    message,
    priority: 2,
    requireInteraction: true,
    buttons: botones.map((accion) => ({ title: ETIQUETAS[accion] })),
  });
}

const botonesPulsados = new Set();
const decisionesEnCurso = new Set();

// accion: "aceptar" | "eliminar" | "entendido" | "cerrar" (incluye "Descartar" en Linux)
export async function aplicarDecision(id, accion) {
  if (!Number.isInteger(id) || !ACCIONES.includes(accion)) return;
  if (decisionesEnCurso.has(id)) return;
  decisionesEnCurso.add(id);

  try {
    const clave = `pend:${id}`;
    const { [clave]: pend } = await chrome.storage.session.get(clave);
    if (!pend) return;

    await chrome.storage.session.remove(clave);
    chrome.notifications.clear(`${PREFIJO_NOTIF}${id}`).catch(() => {});
    log(id, "decisión del usuario", { accion });

    const e = await estado(id);
    if (!e) return;

    const debeEliminar =
      accion === "eliminar" ||
      (accion === "cerrar" && pend.botones.includes("eliminar"));

    try {
      if (accion === "aceptar") {
        if (e.state === "in_progress" && e.paused) await chrome.downloads.resume(id);
      } else if (debeEliminar) {
        if (e.state === "complete") {
          await chrome.downloads.removeFile(id);
          log(id, "removeFile OK tras descartar");
        } else if (e.state === "in_progress") {
          await chrome.downloads.cancel(id);
          log(id, "cancel OK tras descartar");
        }
      }
    } catch (err) {
      log(id, "no se pudo aplicar la decisión", { mensaje: err.message });
    }
  } finally {
    decisionesEnCurso.delete(id);
  }
}

// Mapea el índice del botón presionado a la acción guardada en pend.botones
export async function alClicBotonNotificacion(notifId, buttonIndex) {
  const id = idDesdeNotif(notifId);
  if (id === null) return;

  // Marca de forma síncrona antes de cualquier await para bloquear onClosed
  botonesPulsados.add(id);
  setTimeout(() => botonesPulsados.delete(id), 1000);

  const { [`pend:${id}`]: pend } = await chrome.storage.session.get(`pend:${id}`);
  if (!pend) return;
  const accion = pend.botones[buttonIndex];
  if (accion) await aplicarDecision(id, accion);
}

// Espera un breve margen por si el cierre ocurrió al pulsar "Aceptar" en KDE/D-Bus
export async function alCerrarNotificacion(notifId) {
  const id = idDesdeNotif(notifId);
  if (id === null) return;

  await new Promise((r) => setTimeout(r, 250));
  if (botonesPulsados.has(id)) return;

  await aplicarDecision(id, "cerrar");
}
