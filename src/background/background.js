// Punto de entrada del service worker: solo registra los eventos.
// La lógica vive en descargas.js y avisos.js.
import { procesarDescarga, fallar, alCambiarDescarga } from "./descargas.js";
import { aplicarDecision, alCerrarVentana } from "./avisos.js";

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    await procesarDescarga(item);
  } catch (e) {
    console.error(`[#${item.id}] fallo inesperado`, e);
    await fallar(item);
  }
});

chrome.downloads.onChanged.addListener(alCambiarDescarga);

// Solo se aceptan mensajes de las páginas de esta misma extensión
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.tipo === "decision") aplicarDecision(msg.id, msg.accion);
});

chrome.windows.onRemoved.addListener(alCerrarVentana);
