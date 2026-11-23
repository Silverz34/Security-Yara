import {
  procesarDescarga,
  alCambiarDescarga,
  fallar,
} from "./descargas.js";
import {
  aplicarDecision,
  alCerrarVentana,
} from "./avisos.js";

chrome.downloads.onCreated.addListener((item) => {
  procesarDescarga(item).catch(() => fallar(item));
});

chrome.downloads.onChanged.addListener(alCambiarDescarga);

chrome.windows.onRemoved.addListener(alCerrarVentana);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tipo === "decision") {
    aplicarDecision(msg.id, msg.accion);
  }
});
