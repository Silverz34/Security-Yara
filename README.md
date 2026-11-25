# SecureYara: extensión para Chromium

Extensión de navegador (Manifest V3) que **escanea con reglas YARA cada archivo que descargas** antes de que lo abras, y te explica el resultado en español. El análisis lo hace la [API de SecureYara](https://github.com/Silverz34/Security-Yara-Api); la extensión intercepta la descarga, envía el archivo y muestra el veredicto.

> Proyecto de la asignatura Seguridad Informática, Universidad Politécnica de Chiapas.

## Contenido

1. [¿Qué hace?](#1-qué-hace)
2. [Cómo funciona una descarga](#2-cómo-funciona-una-descarga)
3. [Avisos y ventana emergente](#3-avisos-y-ventana-emergente)
4. [Estructura de carpetas](#4-estructura-de-carpetas)
5. [Permisos](#5-permisos)
6. [Conectar la extensión con la API](#6-conectar-la-extensión-con-la-api)
7. [Instalación](#7-instalación)
8. [Probar la extensión](#8-probar-la-extensión)
9. [Seguridad de la extensión](#9-seguridad-de-la-extensión)
10. [Limitaciones](#10-limitaciones)
11. [Solución de problemas](#11-solución-de-problemas)

---

## 1. ¿Qué hace?

Cuando descargas un archivo, SecureYara:

1. **pausa** la descarga;
2. obtiene el archivo, calcula su **hash SHA-256** y consulta a la API;
3. recibe un **veredicto** (limpio, sospechoso o peligroso) con una explicación y una recomendación;
4. **reanuda** la descarga si está limpia, o te muestra un **aviso** para que decidas **aceptar** o **eliminar** el archivo si es sospechosa o peligrosa.

La API analiza el archivo con reglas YARA y con el **contexto de la descarga** (nombre, extensión, tipo MIME y dominio de origen), lo que permite detectar engaños como una doble extensión (`factura.pdf.exe`) o un ejecutable descargado desde una dirección IP. También inspecciona el interior de los archivos `.zip`.

La extensión incluye una **ventana emergente con estadísticas** de los archivos escaneados.

## 2. Cómo funciona una descarga

1. **Detección.** El *service worker* escucha `chrome.downloads.onCreated`. Se ignoran las descargas de otras extensiones, las muy antiguas y las que no son `http(s)`.
2. **Casos que no se escanean:** si la descarga pesa más de 25 MB, o su dirección es `blob:` o `data:` (el navegador no permite volver a pedirlas), se muestra un aviso y la descarga sigue.
3. **Pausa.** Se pausa lo antes posible. Si la pausa llega tarde (la descarga ya terminó), se pasa al **modo degradado**: el archivo se escanea igual, pero ya fue descargado.
4. **Nombre final.** Se espera hasta 500 ms a que el navegador defina el nombre y el tipo MIME definitivos.
5. **Escaneo.** Se pide el archivo a su sitio de origen, se calcula el SHA-256 y se consulta la caché de la API (`POST /verdicts/lookup`). Si la API no conoce el caso, se sube el archivo (`POST /scan`). Si falla, se reintenta **una vez**; si vuelve a fallar, el resultado es «no se pudo escanear».
6. **Veredicto.** Limpio: se reanuda la descarga. Sospechoso, peligroso, error o archivo demasiado grande: se muestra el aviso y se espera tu decisión.

Mientras dura el escaneo, la extensión envía una señal periódica para que el navegador no suspenda el *service worker*.

## 3. Avisos y ventana emergente

### Avisos

| Situación | Qué ocurre |
|---|---|
| **Peligroso** | Aviso con la explicación, la recomendación y las opciones Aceptar o Eliminar |
| **Sospechoso** | Igual que el anterior, con un nivel de riesgo menor |
| **No se pudo escanear** | Aviso con la opción de aceptar o eliminar el archivo |
| **Archivo de más de 25 MB** | Aviso de que no se escaneó; la descarga continúa |
| **URL `blob:` o `data:`** | Aviso de que no es escaneable; la descarga continúa |

### Ventana emergente (estadísticas)

Al hacer clic en el ícono de la extensión se muestra:

- el total de archivos **escaneados**, con el conteo de **peligrosos** y **sospechosos** en un medidor;
- la lista de **tipos de amenaza detectados** (hasta 5): cada categoría se despliega con su explicación, una recomendación y hasta 3 archivos relevantes con su nivel (Alto o Medio).

Los datos salen de `GET /stats` de la API.

## 4. Estructura de carpetas

```
secureyara-extension/
├── manifest.json               # declaración de la extensión (Manifest V3)
├── images/
│   ├── ico_16.png              # íconos de la extensión
│   └── ico_32.png
└── src/
    ├── background/             # service worker (lógica principal)
    │   ├── background.js       # punto de entrada: registra los eventos de descargas y mensajes
    │   ├── descargas.js        # flujo de cada descarga: pausar, escanear, aplicar el veredicto, reanudar
    │   ├── avisos.js           # avisos y decisión del usuario (aceptar o eliminar)
    │   ├── registro.js         # estado de cada descarga y registro en consola
    │   └── util.js             # utilidades: SHA-256, nombres de archivo, dominio, estado
    ├── popup/                  # ventana emergente de estadísticas
    ├── aviso/                  # página de la ventana de aviso
    └── shared/                 # código común
        ├── config.js           # dirección de la API y límites (único lugar a editar)
        ├── api.js              # todas las llamadas a la API
        ├── clave.example.js    # plantilla de la clave de la API (sin la clave)
        └── clave.js            # clave real: NO se sube a git
```

Valores de `config.js`:

| Constante | Valor | Descripción |
|---|---|---|
| `API_URL` | dirección de la API | Dónde está la API |
| `MAX_BYTES` | 25 MB | Tamaño máximo a escanear; **debe coincidir con el límite de la API** |
| `TIMEOUT_DESCARGA_MS` | 60 000 | Tiempo máximo para pedir el archivo a su sitio de origen |
| `TIMEOUT_API_MS` | 20 000 | Tiempo máximo de cada llamada a la API |

## 5. Permisos

| Permiso | Para qué se usa |
|---|---|
| `downloads` | Detectar, pausar, reanudar y cancelar descargas |
| `storage` | Almacenamiento local de la extensión |
| `host_permissions: <all_urls>` | Pedir el archivo a cualquier sitio de origen para calcular su hash y comunicarse con la API sin restricciones de CORS |

## 6. Conectar la extensión con la API

La API exige una **clave** en cada consulta (cabecera `X-API-Key`), salvo en `/health`. **La clave no está en este repositorio.** Se la da el administrador de la API por separado; **nunca la publiques en git, en capturas ni en el código.**

Pasos para que la extensión pueda consultar la API:

1. **Obtén la clave** de la API con quien administra el servidor.
2. **Crea tu archivo de clave** a partir de la plantilla:

   ```bash
   cp src/shared/clave.example.js src/shared/clave.js
   ```

3. **Escribe la clave** en `src/shared/clave.js`:

   ```js
   export const API_KEY = "la-clave";
   ```
4. **Indica la dirección de la API** en `src/shared/config.js`:

   ```js
   export const API_URL = "https://secureyara.duckdns.org"; // despliegue
   // export const API_URL = "http://127.0.0.1:8000";       // API local
   ```

   Fuera de localhost, la extensión solo acepta direcciones **HTTPS**.

5. **Recarga la extensión** desde la página de extensiones cada vez que cambies `config.js` o `clave.js`.
6. **Comprueba** que el *service worker* arranca y que la consola no muestra errores (ver [Solución de problemas](#11-solución-de-problemas)).

Para rotar la clave: cámbiala en el servidor y en tu `clave.js`, y recarga la extensión.

## 7. Instalación

Requisitos: un navegador basado en Chromium con soporte de Manifest V3 (probada en Vivaldi; compatible en principio con Chrome, Brave y Edge).

1. Clona el repositorio:

   ```bash
   git clone <URL-del-repositorio-de-la-extensión>
   cd secureyara-extension
   ```

2. Completa la configuración (sección 6).
3. Abre la página de extensiones del navegador (`chrome://extensions`, `vivaldi:extensions`, `edge://extensions` o equivalente).
4. Activa el **modo desarrollador**.
5. Pulsa **Cargar desempaquetado** y elige la carpeta que contiene `manifest.json`.

## 8. Probar la extensión

1. Con la API disponible, descarga cualquier archivo: debe escanearse y descargarse con normalidad.
2. Para ver los avisos, usa archivos de prueba. El repositorio de la API incluye `scripts/servidor_muestras.py`, que sirve la carpeta `samples/` en `http://127.0.0.1:9000`:

   | Muestra | Resultado esperado |
   |---|---|
   | Archivo de prueba EICAR (inofensivo) | Peligroso |
   | ZIP con EICAR dentro | Peligroso, «dentro del ZIP» |
   | Archivo con doble extensión (`factura.pdf.exe`) | Sospechoso |
   | Archivo de más de 25 MB | Aviso de tamaño, sin escanear |

3. Abre la ventana emergente: debe mostrar los conteos y las categorías detectadas.
4. Para ver los registros del flujo, abre la consola del *service worker* desde la página de extensiones (enlace «service worker»).

> Una descarga repetida con el mismo nombre, tipo y origen se resuelve desde la caché de la API sin volver a escanear.

## 9. Seguridad de la extensión

- **Solo HTTPS** fuera de localhost: el contenido de los archivos viaja a la API, así que se rechaza cualquier dirección `http://` remota.
- **Todo pasa por `api.js`**: la dirección, la clave, el tiempo máximo y la validación están en un solo módulo.
- **Las respuestas de la API no se aceptan a ciegas:** se valida que traigan un veredicto conocido y una lista de coincidencias.
- **Solo se aceptan mensajes de la propia extensión** (se verifica el identificador del remitente).
- **La clave está fuera de git** (`clave.js` en `.gitignore`, con una plantilla `clave.example.js`).
- **Un fallo es seguro:** si el escaneo falla o la API no responde, la descarga no se reanuda sola: el usuario decide.

## 10. Limitaciones

- **La clave de la API puede extraerse** de la extensión por quien la inspeccione: frena el uso casual, pero no es una autenticación por usuario.
- **El archivo sale del equipo** hacia la API para analizarse; por eso la API exige HTTPS y no guarda el archivo, solo el resultado.
- No se escanean archivos de más de 25 MB ni descargas `blob:` o `data:`.
- En **modo degradado** (la pausa llega tarde), el archivo se escanea cuando la descarga ya terminó.
- Depende de la disponibilidad de la API: sin ella, el resultado es «no se pudo escanear».
- La detección es por firmas: un resultado limpio no garantiza que el archivo sea seguro.
- Se carga en modo desarrollador; no está publicada en la tienda de extensiones.

## 11. Solución de problemas

| Síntoma | Causa probable |
|---|---|
| «Service worker registration failed» al cargar | Falta `src/shared/clave.js` o alguna ruta de importación está mal. Copia `clave.example.js` a `clave.js` |
| Siempre aparece «no se pudo escanear» | La API está apagada o inaccesible, o la clave es incorrecta |
| En la consola: «La API rechazó la clave (401)» | La clave de `clave.js` no coincide con la del servidor |
| La extensión rechaza la dirección | `API_URL` usa `http://` fuera de localhost: usa HTTPS |
| Un cambio en `config.js` o `clave.js` no surte efecto | Hay que recargar la extensión |
| Una muestra nueva sale con el resultado de una anterior | Es la caché: cambia el nombre del archivo o el dominio de origen |

## Repositorio de la API

El análisis lo realiza la **API de SecureYara**: [Silverz34/Security-Yara-Api](https://github.com/Silverz34/Security-Yara-Api). Allí se documentan las reglas YARA, la caché, la base de datos y el despliegue.

## Licencia

Código bajo licencia **MIT** (ver `LICENSE`).
