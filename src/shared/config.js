// Único lugar con la dirección de la API y los límites.
// Para desplegar, cambia solo este archivo.
export const API_URL = "http://127.0.0.1:8000";

export const MAX_BYTES = 25 * 1024 * 1024; // debe coincidir con el límite de la API
export const TIMEOUT_DESCARGA_MS = 60000;  // pedir el archivo a su sitio de origen
export const TIMEOUT_API_MS = 20000;       // cada llamada a la API
