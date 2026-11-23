import {
  procesarDescarga,
  alCambiarDescarga,
  fallar,
} from "./descargas.js";
import {
  alClicBotonNotificacion,
  alCerrarNotificacion
} from "./avisos.js";

// Intercepta nuevas descargas y aplica la red de seguridad ante fallos inesperados
chrome.downloads.onCreated.addListener((item) => {
  procesarDescarga(item).catch(() => fallar(item));
});

// Actualiza nombre de archivo, tipo MIME y estado final de la descarga
chrome.downloads.onChanged.addListener(alCambiarDescarga);

// Maneja las decisiones del usuario desde los botones de la notificación nativa
chrome.notifications.onButtonClicked.addListener(alClicBotonNotificacion);

// Maneja el cierre manual de la notificación (equivalente a cerrar la ventana anterior)
chrome.notifications.onClosed.addListener(alCerrarNotificacion);
