// Todo lo que sale hacia la API pasa por este módulo.
import { API_URL, TIMEOUT_API_MS } from "./config.js";
import { API_KEY } from "./clave.js";
const VEREDICTOS = ["limpio", "sospechoso", "peligroso"];


function validarDestino() {
  const u = new URL(API_URL);
  const local = ["127.0.0.1", "localhost"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) {
    throw new Error("La API debe usarse por HTTPS fuera de localhost");
  }
}

async function llamar(ruta, opciones = {}) {
  validarDestino();
  const headers = new Headers(opciones.headers);
  if (API_KEY) headers.set("X-API-Key", API_KEY);
  const r = await fetch(`${API_URL}${ruta}`, {
    ...opciones,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_API_MS),
  });
  if (r.status === 401) {
    console.error("La API rechazó la clave (401): revisa src/shared/clave.js");
  }
  return r;
}
// No se confía a ciegas en lo que responde la API
function validarResultado(r) {
  if (!r || !VEREDICTOS.includes(r.verdict) || !Array.isArray(r.matches)) {
    throw new Error("Respuesta inesperada de la API");
  }
  return r;
}

export async function consultarCache(hash, ctx) {
  const r = await llamar("/verdicts/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sha256: hash,
      filename: ctx.filename,
      mime: ctx.mime || "",
      source_domain: ctx.source_domain || "",
      scan_mode: ctx.scan_mode || "principal",
    }),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`API ${r.status}`);
  return validarResultado(await r.json());
}

export async function subirEscaneo(hash, buffer, ctx) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), ctx.filename);
  form.append("sha256", hash);
  form.append("filename", ctx.filename);
  form.append("extension", ctx.extension);
  form.append("mime", ctx.mime || "");
  form.append("source_domain", ctx.source_domain);
  form.append("scan_mode", ctx.scan_mode || "principal");
  const r = await llamar("/scan", { method: "POST", body: form });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return validarResultado(await r.json());
}

export async function obtenerStats() {
  const r = await llamar("/stats");
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
