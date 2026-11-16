const id = Number(new URLSearchParams(location.search).get("id"));
const clave = `pend:${id}`;

const TEXTOS = {
  sospechoso: {
    titulo: "Archivo sospechoso",
    resumen: "SecureYara encontró señales de riesgo en este archivo. Tú decides qué hacer.",
  },
  peligroso: {
    titulo: "Archivo peligroso eliminado",
    resumen: "Este archivo es peligroso y SecureYara lo eliminó para protegerte.",
  },
  error: {
    titulo: "No se pudo escanear",
    resumen: "No fue posible analizar este archivo, ni después de un reintento. No sabemos si es seguro.",
  },
  excede_tamano: {
    titulo: "Archivo demasiado grande para escanear",
    resumen: "Este archivo supera el límite de 25 MB, así que no se analizó. No sabemos si es seguro.",
  },
  no_escaneable: {
    titulo: "Este tipo de descarga no se puede escanear",
    resumen: "Este archivo se generó dentro de la propia página (dirección blob: o data:) y SecureYara no puede volver a pedirlo para analizarlo. No sabemos si es seguro.",
  },
};
const ETIQUETAS = { aceptar: "Aceptar", eliminar: "Eliminar", entendido: "Entendido" };

async function iniciar() {
  const { [clave]: pend } = await chrome.storage.session.get(clave);
  if (!pend) {
    window.close();
    return;
  }
  const t = TEXTOS[pend.verdict];
  document.body.className = pend.verdict;
  document.getElementById("titulo").textContent = t.titulo;
  document.getElementById("archivo").textContent = pend.filename;
  document.getElementById("resumen").textContent = t.resumen;

  const lista = document.getElementById("detalles");
  for (const m of pend.matches.filter((x) => x.severity !== "low")) {
    const li = document.createElement("li");
    const titulo = document.createElement("strong");
    titulo.textContent = m.title_es;
    const explicacion = document.createElement("p");
    explicacion.textContent = m.explanation_es;
    const recomendacion = document.createElement("p");
    recomendacion.textContent = m.recommendation_es;
    li.append(titulo, explicacion, recomendacion);
    lista.append(li);
  }

  const contenedor = document.getElementById("botones");
  for (const accion of pend.botones) {
    const boton = document.createElement("button");
    boton.textContent = ETIQUETAS[accion];
    boton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ tipo: "decision", id, accion });
    });
    contenedor.append(boton);
  }
}
iniciar();
