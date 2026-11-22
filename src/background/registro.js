// Estado en memoria de las descargas en curso y registro por consola.
// Ojo: el service worker se duerme; lo que deba sobrevivir va en chrome.storage.session.
export const descargas = new Map();

export function log(id, mensaje, datos) {
  const d = descargas.get(id);
  const ms = d ? Date.now() - d.inicio : 0;
  console.log(`[#${id} +${ms}ms] ${mensaje}` + (datos ? " " + JSON.stringify(datos) : ""));
}
