// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee sitio.config.json (lo define el desarrollador) y data/*.json (lo edita el cliente en /admin):
//     ajustes, categorías, productos, promoción y opiniones
//  2. Optimiza las fotos a WebP (dist/img/_opt, con caché entre builds) y escribe los productos dentro del HTML (para Google)
//  3. Arma la portada (index.html), el catálogo (catalogo.html) y la página de pago (pago.html):
//     reemplaza %%MARCADORES%%, bloques <!-- SI:CLAVE --> y <!-- PARCIAL:nombre --> (carpeta parciales/)
//  4. Escribe canonical, Open Graph, datos estructurados, robots.txt y sitemap.xml
// Uso local: npm run build  →  npm run servir (o node scripts/servir.mjs)
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { leerProductos, str, rel, num, lista } = require('../lib/catalogo.js');
const N = require('../nucleo.js');
const DATA = join(ROOT, 'data');
const DIST = process.env.VV_DIST || join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const avisos = [];
const avisar = (m) => { avisos.push(m); console.warn(`⚠️  ${m}`); };
const readData = (file) => {
  if (!existsSync(join(DATA, file))) return {};
  try { return readJson(join(DATA, file)); } catch (e) { avisar(`data/${file} dañado, se usan valores por defecto: ${e.message}`); return {}; }
};

// Se vacía dist/ por dentro (en Windows la carpeta puede estar abierta por el servidor local o una terminal)
mkdirSync(DIST, { recursive: true });
for (const f of readdirSync(DIST)) rmSync(join(DIST, f), { recursive: true, force: true });

// ---------- Fotos livianas ----------
// WebP del ancho justo en dist/img/_opt/, con hash del contenido en el nombre: el navegador la guarda
// en caché y una foto reemplazada en /admin se ve al tiro. Las ya hechas se guardan en
// node_modules/.cache/vv-img (Vercel conserva esa carpeta entre builds) para no repetir el trabajo.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { avisar('sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const CACHE = join(ROOT, 'node_modules', '.cache', 'vv-img');
const optimizadas = new Map();
const originalesUsadas = new Set();
const SIN_FOTO = 'img/sin-foto.svg';
function optimizar(src, ancho) {
  const path = rel(src);
  if (!path || !existsSync(join(ROOT, path))) return Promise.resolve(SIN_FOTO);
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path)) { originalesUsadas.add(path); return Promise.resolve(path); }
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const nombre = `${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        const out = join(DIST, OPT, nombre);
        const enCache = join(CACHE, nombre);
        mkdirSync(join(DIST, OPT), { recursive: true });
        if (existsSync(enCache)) { copyFileSync(enCache, out); return `${OPT}/${nombre}`; }
        await sharp(buf).rotate().resize({ width: ancho, height: ancho, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toFile(out);
        try { mkdirSync(CACHE, { recursive: true }); copyFileSync(out, enCache); } catch { /* sin caché */ }
        return `${OPT}/${nombre}`;
      } catch (e) {
        avisar(`No se pudo optimizar ${path}: ${e.message}`);
        originalesUsadas.add(path);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
// Muchas fotos a la vez sin saturar la máquina del build
async function enLotes(items, fn, n = 8) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

const config = readJson(join(ROOT, 'sitio.config.json'));
const ajustes = readData('ajustes.json');
const flyer = readData('flyer.json');
const testimoniosData = readData('testimonios.json');
const categoriasData = readData('categorias.json');

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5620').replace(/\/$/, '');

// ---------- 1. Datos ----------
const T = {
  nombre: str(config.nombre),
  lema: str(config.lema),
  rubro: str(config.rubro),
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  mensaje: str(ajustes.mensaje_whatsapp) || `Hola ${str(config.nombre)} 🌿 Quiero hacer una consulta.`,
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  email: str(ajustes.email),
  direccion: str(ajustes.direccion),
  direccionTexto: str(ajustes.direccion_texto) || str(ajustes.direccion),
  referencia: str(ajustes.direccion_referencia),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  zonas: lista(ajustes.zonas),
  mayorista: str(ajustes.mayorista),
  // Medios de pago del paso 3 del pedido
  pagos: lista(ajustes.medios_pago).length ? lista(ajustes.medios_pago) : ['Transferencia', 'Efectivo'],
  // Pago con tarjeta (Klap): se enciende en /admin; además necesita KLAP_APIKEY en Vercel
  pagoOnline: ajustes.pago_online === true,
};

const faltan = ['nombre', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (sitio.config.json / data/ajustes.json)`);
if (T.whatsapp && !/^569\d{8}$/.test(T.whatsapp)) {
  avisar(`WhatsApp inválido "${T.whatsapp}" (debe ser 569 + 8 números, ej 56912345678): se ocultan los botones de WhatsApp`);
  T.whatsapp = '';
}
if (!T.whatsapp) avisar('Sin WhatsApp: se ocultan el pedido y los botones de WhatsApp');
if (T.pagoOnline && !T.whatsapp) T.pagoOnline = false;
const IG_URL = T.instagram ? `https://www.instagram.com/${T.instagram}/` : '';
// Sin WhatsApp, los botones llevan al Instagram (mensaje directo)
const wa = (texto) => (T.whatsapp ? `https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(texto)}` : IG_URL || '#visitanos');

// Horario por día (lunes a domingo). Un día sin horas válidas cuenta como cerrado.
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const hora = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(str(v)) ? str(v) : '');
const horarioIn = Array.isArray(ajustes.horario) ? ajustes.horario : [];
const horario = DIAS.map((dia, i) => {
  const d = horarioIn.find((x) => x && str(x.dia).toLowerCase() === dia.toLowerCase()) || horarioIn[i] || {};
  const tramos = [];
  if (d.cerrado !== true) {
    for (const [a, c] of [[d.abre, d.cierra], [d.abre2, d.cierra2]]) {
      if (hora(a) && hora(c) && hora(a) < hora(c)) tramos.push([hora(a), hora(c)]);
      else if (str(a) || str(c)) avisar(`Horario del ${dia}: "${str(a)}–${str(c)}" no es válido (usa HH:MM, ej 09:30), se ignora`);
    }
  }
  return { dia, tramos };
});
const hayHorario = horario.some((d) => d.tramos.length);

// Productos (lib/catalogo.js: el mismo lector que usa el cobro con tarjeta)
const productos = leerProductos(ROOT, { avisar });
for (const p of productos) {
  if (p.portada && !existsSync(join(ROOT, p.portada))) { avisar(`${p.nombre}: no existe la foto ${p.portada}`); p.portada = ''; }
  p.fotos = p.fotos.filter((f) => existsSync(join(ROOT, f)) || (avisar(`${p.nombre}: no existe la foto ${f}`), false));
}
if (!productos.length) avisar('No hay productos visibles');

// Categorías: el orden de data/categorias.json; las que no estén ahí van al final
const ordenCat = lista((Array.isArray(categoriasData.categorias) ? categoriasData.categorias : []).map((c) => c && c.nombre));
const conteo = new Map();
productos.forEach((p) => conteo.set(p.categoria, (conteo.get(p.categoria) || 0) + 1));
const categorias = [...ordenCat.filter((c) => conteo.has(c)), ...[...conteo.keys()].filter((c) => !ordenCat.includes(c))];
ordenCat.filter((c) => !conteo.has(c)).forEach((c) => console.log(`ℹ️  La categoría «${c}» no tiene productos visibles: no se muestra`));

// Portada: las marcadas «Mostrar en la página principal» (si no hay ninguna, las 10 primeras)
let inicio = productos.filter((p) => p.inicio);
if (!inicio.length) inicio = productos.slice(0, 10);

// Fotos: tarjetas del catálogo (600), ficha (1400) y tarjetas de la portada (700 / 1100 la destacada)
const t0 = Date.now();
await enLotes(productos, async (p) => {
  p.mini = await optimizar(p.portada, 600);
  p.galeria = p.portada ? await Promise.all([p.portada, ...p.fotos].map((f) => optimizar(f, 1400))) : [SIN_FOTO];
});
await enLotes(inicio, async (p, i) => { p.home = await optimizar(p.portada, i === 0 ? 1100 : 700); });

const testimonios = (Array.isArray(testimoniosData.testimonios) ? testimoniosData.testimonios : [])
  .map((t) => ({ texto: str(t && t.texto), nombre: str(t && t.nombre), detalle: str(t && t.detalle) })).filter((t) => t.texto && t.nombre);
// Cifras de «En el vivero hay mucho más»: se cuentan solas desde el catálogo (las 4 categorías con más productos)
const cifras = [...conteo].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => ({ numero: n, texto: c.toLowerCase() }));

const FLYER_ON = flyer.mostrar === true && rel(flyer.imagen) && existsSync(join(ROOT, rel(flyer.imagen)));
console.log(`✅ datos: ${productos.length} productos (${inicio.length} en la portada, ${productos.filter((p) => p.agotado).length} agotados), ${categorias.length} categorías, ${testimonios.length} opiniones, horario ${hayHorario ? 'sí' : 'no'}, promo ${FLYER_ON ? 'sí' : 'no'}, pago con tarjeta ${T.pagoOnline ? 'sí' : 'no'} · fotos en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------- 2. HTML de las secciones ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const clp = N.clp;
const pad = (n) => String(n).padStart(2, '0');
const msgProducto = (p) => `Hola ${T.nombre} 🌿 Quiero info de *${p.nombre}*${p.precio ? ` (${clp(p.precio)})` : ''} 👋`;
const CATALOGO_URL = 'catalogo';

// Tarjeta de la portada (etiqueta de vivero)
const productoHtml = (p, i) => `
        <article class="planta${i === 0 ? ' planta--hero' : ''}" data-cat="${esc(p.categoria)}" data-reveal style="--d:${(i % 3) * 90}ms">
          <button type="button" class="planta__btn" data-planta="${esc(p.id)}" aria-label="Ver ficha de ${esc(p.nombre)}">
            <span class="planta__foto">
              <img src="${esc(p.home)}" alt="${esc(p.nombre)} en ${esc(T.nombre)}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">
              ${p.etiqueta ? `<span class="planta__cinta">${esc(p.etiqueta)}</span>` : ''}
              ${p.galeria.length > 1 ? `<span class="planta__fotos">${p.galeria.length} fotos</span>` : ''}
            </span>
            ${i === 0 && p.descripcion ? `<span class="planta__desc">${esc(p.descripcion)}</span>` : ''}
            <span class="tag">
              <span class="tag__ojal" aria-hidden="true"></span>
              <small class="tag__cat">${pad(i + 1)} · ${esc(p.categoria)}</small>
              <strong class="tag__nombre">${esc(p.nombre)}</strong>
              <span class="tag__precio">${p.agotado ? 'Agotado por ahora' : p.precio ? esc(clp(p.precio)) : 'Consultar precio'}</span>
            </span>
          </button>
          ${T.whatsapp
    ? (p.agotado ? '' : `<button type="button" class="planta__agregar" data-agregar="${esc(p.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-bolsa"/></svg><span>Agregar al pedido</span></button>`)
    : `<a class="planta__wa" href="${esc(wa(msgProducto(p)))}" target="_blank" rel="noopener">Consultar por Instagram</a>`}
        </article>`;

const catInicio = [...new Set(inicio.map((p) => p.categoria))];
const filtrosHtml = ['Todas', ...catInicio].map((c, i) =>
  `<button type="button" class="filtro${i === 0 ? ' is-on' : ''}" data-filtro="${esc(i === 0 ? '*' : c)}" aria-pressed="${i === 0}">${esc(c)}</button>`).join('');

// Tarjeta del catálogo: foto, nombre, precio y control de cantidad
const tarjetaHtml = (p, i) => `
        <article class="prod${p.agotado ? ' is-agotado' : ''}" data-id="${esc(p.id)}">
          <button type="button" class="prod__foto" data-planta="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
            <img src="${esc(p.mini)}" alt="${esc(p.nombre)}" width="600" height="600" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async">
            ${p.agotado ? '<span class="prod__sello">Agotado</span>' : p.etiqueta ? `<span class="prod__sello prod__sello--cinta">${esc(p.etiqueta)}</span>` : ''}
          </button>
          <div class="prod__info">
            <p class="prod__cat">${esc(p.categoria)}</p>
            <h3 class="prod__nombre"><button type="button" data-planta="${esc(p.id)}">${esc(p.nombre)}</button></h3>
            <p class="prod__precio">${p.precio ? esc(clp(p.precio)) : 'Consultar'}${p.precioMayor ? ` <small>Por mayor ${esc(clp(p.precioMayor))}</small>` : ''}</p>
          </div>
          ${T.whatsapp ? (p.agotado
    ? `<a class="prod__avisar" href="${esc(wa(`Hola ${T.nombre} 🌿 ¿Cuándo vuelve a llegar *${p.nombre}*? 🙏`))}" target="_blank" rel="noopener">Avísame cuando llegue</a>`
    : `<div class="ctrl" data-ctrl="${esc(p.id)}">
            <button type="button" class="ctrl__agregar" data-agregar="${esc(p.id)}" aria-label="Agregar ${esc(p.nombre)} al pedido"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-bolsa"/></svg><span>Agregar</span></button>
            <div class="ctrl__paso" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
              <button type="button" data-restar="${esc(p.id)}" aria-label="Quitar uno">−</button>
              <span data-ctrl-q aria-live="polite">0</span>
              <button type="button" data-sumar="${esc(p.id)}" aria-label="Agregar uno">+</button>
            </div>
          </div>`) : ''}
        </article>`;

const chipsHtml = [['', 'Todo', productos.length], ...categorias.map((c) => [c, c, conteo.get(c)])].map(([v, t, n], i) =>
  `<button type="button" class="chip${i === 0 ? ' is-on' : ''}" data-chip="${esc(v)}" aria-pressed="${i === 0}">${esc(t)} <span>${n}</span></button>`).join('');

// Vitrina de la portada: una foto por categoría que lleva al catálogo ya filtrado
const vitrina = categorias.map((c) => ({ c, n: conteo.get(c), p: productos.find((p) => p.categoria === c && p.portada && !p.agotado) || productos.find((p) => p.categoria === c) }));
const vitrinaHtml = (v, i) => `
        <a class="tile" href="${CATALOGO_URL}?cat=${encodeURIComponent(v.c)}" data-reveal style="--d:${(i % 4) * 70}ms">
          <img src="${esc(v.p.mini)}" alt="" loading="lazy" decoding="async" width="600" height="600">
          <span class="tile__txt"><strong>${esc(v.c)}</strong><small>${v.n} ${v.n === 1 ? 'producto' : 'productos'}</small></span>
        </a>`;

const cifraHtml = (c, i) => `
          <li data-reveal style="--d:${i * 80}ms"><strong data-count="${c.numero}">${N.miles(c.numero)}</strong><span>${esc(c.texto)}</span></li>`;

const testimonioHtml = (t, i) => `
        <figure class="opinion" data-reveal style="--d:${i * 80}ms">
          <blockquote>“${esc(t.texto)}”</blockquote>
          <figcaption><strong>${esc(t.nombre)}</strong>${t.detalle ? `<span>${esc(t.detalle)}</span>` : ''}</figcaption>
        </figure>`;

const tramosTexto = (d) => (d.tramos.length ? d.tramos.map(([a, c]) => `${a} – ${c}`).join(' · ') : 'Cerrado');
const horarioHtml = horario.map((d, i) => `
            <li data-dia="${i}"><span>${esc(d.dia)}</span><span class="tramos">${d.tramos.length
    ? d.tramos.map(([a, c]) => `<span>${a}–${c}</span>`).join('') : 'Cerrado'}</span></li>`).join('');

// Resumen corto del horario ("Martes a domingo · 10:00 – 13:00 · 14:00 – 18:30")
function resumenHorario() {
  const grupos = [];
  horario.forEach((d, i) => {
    const t = tramosTexto(d);
    const g = grupos[grupos.length - 1];
    if (g && g.t === t) g.fin = i; else grupos.push({ ini: i, fin: i, t });
  });
  return grupos.filter((g) => g.t !== 'Cerrado').map((g) => {
    const dias = g.ini === g.fin ? DIAS[g.ini] : `${DIAS[g.ini]} a ${DIAS[g.fin].toLowerCase()}`;
    return `${dias} · ${g.t}`;
  }).join(' / ');
}
const zonasTexto = T.zonas.length > 3 ? `${T.zonas.slice(0, 3).join(', ')} y más` : T.zonas.join(', ') || 'tu comuna';

// ---------- 3. Marcadores ----------
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const F_TITULOS = fuentes.titulos || 'Jost';
const F_TEXTO = fuentes.texto || 'Jost';
// Acento: la cursiva elegante de las palabras destacadas (<em>) y los precios grandes
const F_MANO = fuentes.acento || fuentes.mano || 'Cormorant Garamond';
const fam = (f) => encodeURIComponent(f).replace(/%20/g, '+');
const heroFoto = rel(ajustes.hero_foto) || (inicio[0] && inicio[0].portada) || 'img/logo.jpg';
const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro} en ${T.ciudad}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || str(ajustes.hero_bajada);
const CAT_DESCRIPCION = `Catálogo de ${T.nombre}: ${productos.length} productos con precio (${categorias.slice(0, 5).join(', ').toLowerCase()} y más). Retiro en ${T.ciudad} o despacho. Pide por WhatsApp.`;
const mapaQ = encodeURIComponent(T.direccion);
const flyerImg = FLYER_ON ? await optimizar(rel(flyer.imagen), 1000) : '';

// Solo lo que necesita el navegador: todos los productos en formato corto (nucleo.js / tienda.js)
const SITIO = {
  whatsapp: T.whatsapp,
  ig: IG_URL,
  horario: horario.map((d) => d.tramos),
  popup: FLYER_ON && flyer.popup === true,
  pagoOnline: T.pagoOnline,
  categorias,
  productos: Object.fromEntries(productos.map((p, i) => [p.id, Object.fromEntries(Object.entries({
    n: p.nombre, c: p.categoria, v: p.precio, w: p.precioMayor, m: p.mini, f: p.galeria,
    d: p.descripcion, l: p.luz, r: p.riego, e: p.etiqueta, a: p.agotado ? 1 : 0, o: i,
  // Los campos vacíos se omiten para pesar menos; v (precio), a (agotado) y o (orden) siempre van
  }).filter(([k, v]) => (v !== '' && v !== 0) || ['v', 'a', 'o'].includes(k)))])),
};

const VARS = {
  NOMBRE: T.nombre, LEMA: T.lema, RUBRO: T.rubro,
  SEO_TITULO, SEO_DESCRIPCION, CAT_DESCRIPCION,
  CIUDAD: T.ciudad, REGION: T.region, EMAIL: T.email, INSTAGRAM: T.instagram, IG_URL,
  CATALOGO: '1', CATALOGO_URL, CAT_N: String(productos.length), ZONAS_TEXTO: zonasTexto,
  DIRECCION_CORTA: [T.direccionTexto, T.region].filter(Boolean).join(' · ') || T.ciudad,
  MAYORISTA: T.mayorista,
  MAYORISTA_O_TEXTO: T.mayorista || 'Cotiza por cantidad para tu jardín, tu parcela o tu negocio: te respondemos por WhatsApp.',
  WHATSAPP: T.whatsapp,
  WA_LINK: wa(T.mensaje),
  WA_MAYOR: wa(`Hola ${T.nombre} 🌿 Tengo un negocio y quiero consultar *precios por mayor* 📦`),
  WA_NUMERO: T.whatsapp ? `+56 9 ${T.whatsapp.slice(3, 7)} ${T.whatsapp.slice(7)}` : '',
  DIRECCION: T.direccion, DIRECCION_TEXTO: T.direccionTexto, REFERENCIA: T.referencia,
  MAPA_SRC: T.direccion ? `https://www.google.com/maps?q=${mapaQ}&output=embed` : '',
  MAPA_LINK: T.direccion ? `https://www.google.com/maps/search/?api=1&query=${mapaQ}` : '',
  HORARIO: hayHorario ? '1' : '', HORARIO_RESUMEN: resumenHorario(),
  HERO_EYEBROW: str(ajustes.hero_eyebrow), HERO_TITULO: str(ajustes.hero_titulo), HERO_DESTACADO: str(ajustes.hero_destacado),
  HERO_BAJADA: str(ajustes.hero_bajada), HERO_NOTA: str(ajustes.hero_foto_nota),
  HERO_FOTO: await optimizar(heroFoto, 1400), HERO_FOTO_MOVIL: await optimizar(heroFoto, 760),
  VIVERO_FOTO: await optimizar('img/vivero/coronas-del-inca-2.jpg', 900),
  VIVERO_FOTO_2: await optimizar('img/vivero/crisantemos-1.jpg', 700),
  SAG: ajustes.sag === true ? '1' : '',
  CIFRAS: cifras.length ? '1' : '', TESTIMONIOS: testimonios.length ? '1' : '',
  FILTROS: catInicio.length > 1 ? '1' : '', N_PRODUCTOS: String(productos.length),
  PAGO_ONLINE: T.pagoOnline ? '1' : '',
  FLYER: FLYER_ON ? '1' : '', FLYER_IMG: flyerImg, FLYER_TITULO: str(flyer.titulo), FLYER_TEXTO: str(flyer.texto),
  FLYER_LINK: wa(str(flyer.mensaje_whatsapp) || `Hola ${T.nombre} 🌿 Vi la promo${flyer.titulo ? ` *${str(flyer.titulo)}*` : ''} en la web 👋`),
  FUENTES_URL: `https://fonts.googleapis.com/css2?${[...new Set([F_TITULOS, F_TEXTO, F_MANO])].map((f) => `family=${fam(f)}:ital,wght@0,300..700;1,300..700`).join('&')}&display=swap`,
  FUENTE_TITULOS: F_TITULOS, FUENTE_TEXTO: F_TEXTO, FUENTE_MANO: F_MANO,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`, ANIO: String(new Date().getFullYear()),
  COLOR_TINTA: colores.tinta, COLOR_HOJA: colores.hoja, COLOR_HOJA_OSCURA: colores.hoja_oscura, COLOR_BROTE: colores.brote,
  COLOR_TERRACOTA: colores.terracota, COLOR_PAPEL: colores.papel, COLOR_CREMA: colores.crema, COLOR_LINEA: colores.linea,
  SITIO_JSON: JSON.stringify(SITIO).replace(/</g, '\\u003c'),
  // Opciones del campo «Categoría» en /admin (salen de data/categorias.json)
  CATEGORIAS_YAML: JSON.stringify(categorias.length ? [...new Set([...ordenCat, ...categorias])] : ['Otros']),
};

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía
function render(text, file, escape) {
  let out = text;
  for (let prev; prev !== out;) {
    prev = out;
    out = out.replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(VARS[key]) ? body : ''));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = VARS[key];
    if (v === undefined || v === null || (v === '' && key.startsWith('COLOR_'))) { missing.add(key); return m; }
    return escape && !['SITIO_JSON'].includes(key) ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}
// <!-- PARCIAL:nombre --> → contenido de parciales/nombre.html (antes de reemplazar marcadores)
const parcial = (html) => html.replace(/<!-- PARCIAL:([a-z0-9-]+) -->/g, (m, nombre) => {
  const f = join(ROOT, 'parciales', `${nombre}.html`);
  if (!existsSync(f)) throw new Error(`Falta parciales/${nombre}.html`);
  return readFileSync(f, 'utf8');
});

// ---------- 4. SEO ----------
const OG_IMAGE = abs(heroFoto);
const DIA_SCHEMA = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const geo = config.geo || {};
const negocio = {
  '@context': 'https://schema.org',
  '@type': str(config.schema_tipo) || 'GardenStore',
  '@id': `${SITE}/#vivero`,
  name: T.nombre,
  slogan: T.lema || undefined,
  description: SEO_DESCRIPCION,
  url: `${SITE}/`,
  logo: abs('img/logo.jpg'),
  image: [OG_IMAGE, ...inicio.slice(0, 4).filter((p) => p.portada).map((p) => abs(p.portada))],
  email: T.email || undefined,
  telephone: T.whatsapp ? `+${T.whatsapp}` : undefined,
  priceRange: '$$',
  currenciesAccepted: 'CLP',
  areaServed: T.zonas.map((name) => ({ '@type': 'Place', name })),
  address: {
    '@type': 'PostalAddress',
    streetAddress: T.direccionTexto || undefined,
    addressLocality: T.ciudad,
    addressRegion: T.region || undefined,
    addressCountry: 'CL',
  },
  geo: str(geo.lat) && str(geo.lng) ? { '@type': 'GeoCoordinates', latitude: Number(geo.lat), longitude: Number(geo.lng) } : undefined,
  hasMap: VARS.MAPA_LINK || undefined,
  openingHoursSpecification: hayHorario
    ? horario.flatMap((d, i) => d.tramos.map(([opens, closes]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: DIA_SCHEMA[i], opens, closes })))
    : undefined,
  sameAs: [IG_URL].filter(Boolean),
  hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Catálogo', url: `${SITE}/${CATALOGO_URL}` },
};
const oferta = (p) => ({
  '@type': 'Product',
  name: p.nombre,
  category: p.categoria,
  url: `${SITE}/${CATALOGO_URL}?p=${encodeURIComponent(p.id)}`,
  image: p.portada ? abs(p.mini) : undefined,
  description: p.descripcion || undefined,
  offers: p.precio ? {
    '@type': 'Offer', price: p.precio, priceCurrency: 'CLP',
    availability: p.agotado ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    seller: { '@id': `${SITE}/#vivero` },
  } : undefined,
});
const listaProductos = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: `Catálogo de ${T.nombre}`,
  numberOfItems: productos.length,
  itemListElement: productos.map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: oferta(p) })),
};

const cabeza = ({ ruta, titulo, descripcion, ld }) => `<link rel="canonical" href="${SITE}/${ruta}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/${ruta}">
  <meta property="og:title" content="${esc(titulo)}">
  <meta property="og:description" content="${esc(descripcion)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  ${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n  ')}`;

// ---------- 5. dist/ ----------
cpSync(join(ROOT, 'img'), join(DIST, 'img'), {
  recursive: true,
  // Con sharp, las fotos de productos van optimizadas en img/_opt: las originales solo si alguna falló
  filter: (src) => !sharp || !/[\\/]img[\\/]productos[\\/].+/.test(src) || [...originalesUsadas].some((o) => src.replace(/\\/g, '/').endsWith(o)),
});
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });

// Archivos estáticos con ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
const estaticos = {};
for (const f of ['styles.css', 'nucleo.js', 'tienda.js', 'app.js', 'catalogo.js', 'pago.js']) {
  const texto = f === 'styles.css' ? render(readFileSync(join(ROOT, f), 'utf8'), f, false) : readFileSync(join(ROOT, f), 'utf8');
  writeFileSync(join(DIST, f), texto);
  estaticos[f] = version(texto);
}
const conVersion = (html) => html.replace(/(href|src)="(styles\.css|nucleo\.js|tienda\.js|app\.js|catalogo\.js|pago\.js)"/g, (m, attr, f) => `${attr}="${f}?v=${estaticos[f]}"`);

const BLOQUES_COMUNES = {
  '<!-- ZONAS -->': T.zonas.map((z) => `<option>${esc(z)}</option>`).join(''),
  '<!-- PAGOS -->': T.pagos.map((m, i) => `<label class="opcion"><input type="radio" name="pago" value="${esc(m)}"${i === 0 ? ' checked' : ''}><span>${esc(m)}</span></label>`).join(''),
};
function pagina(origen, destino, { bloques = {}, seo }) {
  let html = parcial(readFileSync(join(ROOT, origen), 'utf8'));
  const todos = { ...BLOQUES_COMUNES, ...bloques };
  for (const marker of [...(seo ? ['<!-- SEO:HEAD'] : []), ...Object.keys(bloques)]) {
    if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en ${origen}`);
  }
  html = render(html, origen, true);
  if (seo) html = html.replace(/<!-- SEO:HEAD[^>]*-->/, cabeza(seo));
  for (const [marker, contenido] of Object.entries(todos)) html = html.replaceAll(marker, contenido);
  html = conVersion(html);
  const sobra = html.match(/%%[A-Z0-9_]+%%|<!-- (PARCIAL|SI):/);
  if (sobra) throw new Error(`${origen}: quedó sin reemplazar ${sobra[0]}`);
  writeFileSync(join(DIST, destino), html);
}

pagina('index.html', 'index.html', {
  bloques: {
    '<!-- PRODUCTOS -->': inicio.map(productoHtml).join(''),
    '<!-- FILTROS -->': filtrosHtml,
    '<!-- CIFRAS -->': cifras.map(cifraHtml).join(''),
    '<!-- TESTIMONIOS -->': testimonios.map(testimonioHtml).join(''),
    '<!-- HORARIO_DIAS -->': horarioHtml,
    '<!-- VITRINA -->': vitrina.map(vitrinaHtml).join(''),
    '<!-- MARQUESINA -->': [...inicio, ...inicio].map((p) => `<span>${esc(p.nombre)}</span>`).join(''),
  },
  seo: { ruta: '', titulo: SEO_TITULO, descripcion: SEO_DESCRIPCION, ld: [negocio] },
});
pagina('catalogo.html', 'catalogo.html', {
  bloques: {
    '<!-- CHIPS -->': chipsHtml,
    '<!-- CAT_PRODUCTOS -->': productos.map(tarjetaHtml).join(''),
  },
  seo: { ruta: CATALOGO_URL, titulo: `Catálogo de plantas y precios | ${T.nombre}`, descripcion: CAT_DESCRIPCION, ld: [listaProductos] },
});
pagina('pago.html', 'pago.html', {});
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /pago\n\nSitemap: ${SITE}/sitemap.xml\n`);
const hoy = new Date().toISOString().slice(0, 10);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${hoy}</lastmod></url>
  <url><loc>${SITE}/${CATALOGO_URL}</loc><lastmod>${hoy}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) avisar('Falta img/logo.jpg (logo)');
// Resumen para las pruebas (npm test lo lee)
writeFileSync(join(DIST, '.build.json'), JSON.stringify({ productos: productos.length, inicio: inicio.length, categorias, avisos }, null, 2));
console.log(`✅ sitio listo en ${dirname(join(DIST, 'x'))} para ${SITE} (${avisos.length} avisos)`);
