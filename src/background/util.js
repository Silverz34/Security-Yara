// Funciones pequeñas y sin estado propio.
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export const nombreBase = (ruta) => (ruta || "").split(/[\\/]/).pop();

export function extensionDe(nombre) {
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(i + 1).toLowerCase() : "";
}

export function dominioDe(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

export async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Estado real de una descarga (pause() no falla aunque llegue tarde, por eso se revisa)
export async function estado(id) {
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
