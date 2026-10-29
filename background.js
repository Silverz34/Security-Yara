const ESPERA_MS = 5000; // simula el tiempo que tardaría el escaneo
const inicio = new Map(); // id de descarga -> momento en que la vimos nacer

function log(id, mensaje, datos) {
  const ms = inicio.has(id) ? Date.now() - inicio.get(id) : 0;
  console.log(`[#${id} +${ms}ms] ${mensaje}`, datos ?? "");
}

async function estado(id) {
  const [d] = await chrome.downloads.search({ id });
  return d && {
    state: d.state,
    paused: d.paused,
    canResume: d.canResume,
    bytesReceived: d.bytesReceived,
    totalBytes: d.totalBytes,
    error: d.error,
  };
}

chrome.downloads.onCreated.addListener(async (item) => {
  const id = item.id;
  inicio.set(id, Date.now());
  log(id, "onCreated", {
    url: item.url,
    mime: item.mime,
    state: item.state,
    totalBytes: item.totalBytes,
    canResume: item.canResume,
  });

  // 1) Intentar pausar
  let pausada = false;
  try {
    await chrome.downloads.pause(id);
    pausada = true;
    log(id, "pause OK");
  } catch (e) {
    log(id, "pause FALLÓ (probablemente ya terminó): " + e.message);
  }
  log(id, "estado tras intentar pausar", await estado(id));

  if (!pausada) return; // aquí entraría el "modo degradado"

  // 2) Esperar (simula el escaneo) y reanudar
  setTimeout(async () => {
    log(id, "estado antes de reanudar", await estado(id));
    try {
      await chrome.downloads.resume(id);
      log(id, "resume OK");
    } catch (e) {
      log(id, "resume FALLÓ: " + e.message);
    }
    log(id, "estado tras reanudar", await estado(id));
  }, ESPERA_MS);
});

// Ver cada cambio de estado (completa, interrumpida, pausada...)
chrome.downloads.onChanged.addListener((delta) => {
  const cambios = {};
  for (const [campo, valor] of Object.entries(delta)) {
    if (campo !== "id") cambios[campo] = valor.current;
  }
  log(delta.id, "onChanged", cambios);
});
