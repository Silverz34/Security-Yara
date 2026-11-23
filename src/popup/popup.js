import { obtenerStats } from "../shared/api.js";

const NIVELES = { high: "Alto", medium: "Medio", low: "Bajo" };
const RADIO = 70; // radio del arco (coincide con el de popup.html)

function el(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function dibujarArco(s) {
  const largo = Math.PI * RADIO;
  const tramo = (n) => (n ? Math.max((n / s.total) * largo, 4) : 0);
  const peligroso = tramo(s.peligrosos);
  const sospechoso = tramo(s.sospechosos);
  document.getElementById("arco-peligroso").setAttribute("stroke-dasharray", `${peligroso} ${largo}`);
  const arcoSospechoso = document.getElementById("arco-sospechoso");
  arcoSospechoso.setAttribute("stroke-dasharray", `${sospechoso} ${largo}`);
  arcoSospechoso.setAttribute("stroke-dashoffset", String(-peligroso));
}

function dibujarResumen(s) {
  document.getElementById("total").textContent = String(s.total);
  document.getElementById("n-peligroso").textContent = String(s.peligrosos);
  document.getElementById("n-sospechoso").textContent = String(s.sospechosos);
  dibujarArco(s);
}

function dibujarCategorias(categorias) {
  const lista = document.getElementById("categorias");
  if (!categorias.length) {
    lista.append(el("p", "vacio", "Sin alertas por ahora."));
    return;
  }
  const maximo = Math.max(...categorias.map((c) => c.cantidad));
  for (const c of categorias) {
    const item = el("div", "categoria");
    const boton = el("button", "cat-boton");
    boton.type = "button";
    boton.setAttribute("aria-expanded", "false");
    const barra = el("span", "cat-barra");
    const relleno = el("i");
    relleno.style.width = `${(c.cantidad / maximo) * 100}%`;
    barra.append(relleno);
    boton.append(
      el("span", "cat-nombre", c.nombre_corto || c.nombre_es),
      el("span", "cat-numero", String(c.cantidad)),
      barra,
      el("span", "cat-flecha", "▾")
    );

    const detalle = el("div", "detalle");
    detalle.hidden = true;
    detalle.append(
      el("p", "explicacion", c.explicacion_es),
      el("p", "recomendacion", `Recomendación: ${c.recomendacion_es}`),
      el("h3", "", "Archivos relevantes")
    );
    const archivos = el("ul", "archivos");
    for (const a of c.archivos) {
      const li = el("li");
      li.append(el("span", "archivo-nombre", a.filename));
      if (a.veces > 1) li.append(el("span", "veces", `×${a.veces}`));
      li.append(el("span", `nivel ${a.severity}`, NIVELES[a.severity] || a.severity));
      archivos.append(li);
    }
    detalle.append(archivos);

    boton.addEventListener("click", () => {
      const abrir = detalle.hidden;
      for (const d of lista.querySelectorAll(".detalle")) d.hidden = true;
      for (const b of lista.querySelectorAll(".cat-boton")) b.setAttribute("aria-expanded", "false");
      detalle.hidden = !abrir;
      boton.setAttribute("aria-expanded", String(abrir));
    });
    item.append(boton, detalle);
    lista.append(item);
  }
}

async function iniciar() {
  const mensaje = document.getElementById("mensaje");
  try {
    const s = await obtenerStats();
    if (s.total === 0) {
      mensaje.textContent = "Aún no hay descargas analizadas.";
      return;
    }
    mensaje.hidden = true;
    document.getElementById("contenido").hidden = false;
    dibujarResumen(s);
    dibujarCategorias(s.categorias);
  } catch {
    mensaje.textContent = "No se pudo conectar con la API de SecureYara.";
  }
}
iniciar();
