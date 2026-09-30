// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee sitio.config.json (lo define el desarrollador) y data/*.json (lo edita el cliente en /admin):
//     ajustes (contacto, dirección, horario, portada), productos, flyer y testimonios
//  2. Optimiza las fotos a WebP (dist/img/_opt) y escribe las tarjetas dentro del HTML (para Google)
//  3. Reemplaza los %%MARCADORES%% y bloques <!-- SI:CLAVE -->, y genera canonical, Open Graph,
//     datos estructurados, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  servir la carpeta dist/
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readData = (file) => {
  if (!existsSync(join(DATA, file))) return {};
  try { return readJson(join(DATA, file)); } catch (e) { console.warn(`⚠️  data/${file} dañado, se usan valores por defecto: ${e.message}`); return {}; }
};

// Se vacía dist/ por dentro (en Windows la carpeta puede estar abierta por el servidor local o una terminal)
mkdirSync(DIST, { recursive: true });
for (const f of readdirSync(DIST)) rmSync(join(DIST, f), { recursive: true, force: true });

// ---------- Fotos livianas ----------
// Copia WebP del ancho justo en dist/img/_opt/, con hash del contenido en el nombre:
// el navegador la guarda en caché y una foto reemplazada en /admin se ve al tiro.
// Si sharp no está instalado, se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
function optimizar(src, ancho) {
  const path = String(src || '').replace(/^\//, '');
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 76 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}

const config = readJson(join(ROOT, 'sitio.config.json'));
const ajustes = readData('ajustes.json');
const flyer = readData('flyer.json');
const testimoniosData = readData('testimonios.json');

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5620').replace(/\/$/, '');

// ---------- 1. Datos ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const rel = (path) => str(path).replace(/^\//, '');
const num = (v, def) => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : def);
const lista = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const T = {
  nombre: str(config.nombre),
  lema: str(config.lema),
  rubro: str(config.rubro),
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  mensaje: str(ajustes.mensaje_whatsapp) || `Hola ${str(config.nombre)} 🌿 Quiero hacer una consulta.`,
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  email: str(ajustes.email),
  catalogo: str(ajustes.catalogo_url),
  direccion: str(ajustes.direccion),
  direccionTexto: str(ajustes.direccion_texto) || str(ajustes.direccion),
  referencia: str(ajustes.direccion_referencia),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  zonas: lista(ajustes.zonas),
  mayorista: str(ajustes.mayorista),
};

const faltan = ['nombre', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (sitio.config.json / data/ajustes.json)`);
if (T.whatsapp && !/^569\d{8}$/.test(T.whatsapp)) {
  console.warn(`⚠️  WhatsApp inválido "${T.whatsapp}" (debe ser 569 + 8 números, ej 56912345678): se ocultan los botones de WhatsApp`);
  T.whatsapp = '';
}
if (!T.whatsapp) console.warn('⚠️  Sin WhatsApp: se ocultan el formulario y los botones de WhatsApp');
const IG_URL = T.instagram ? `https://www.instagram.com/${T.instagram}/` : '';
// Sin WhatsApp, los botones llevan al Instagram (mensaje directo)
const wa = (texto) => (T.whatsapp ? `https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(texto)}` : IG_URL || '#contacto');

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
      else if (str(a) || str(c)) console.warn(`⚠️  Horario del ${dia}: "${str(a)}–${str(c)}" no es válido (usa HH:MM, ej 09:30), se ignora`);
    }
  }
  return { dia, tramos };
});
const hayHorario = horario.some((d) => d.tramos.length);

function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar la web: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}
const conNombre = (x) => x.visible !== false && typeof x.nombre === 'string' && x.nombre.trim();

const productos = readFolder('productos').filter(conNombre).map((p) => {
  const precio = Math.round(num(p.precio, 0));
  return {
    id: p.id,
    nombre: p.nombre.trim(),
    categoria: str(p.categoria) || 'Plantas',
    precio: precio > 0 ? precio : 0,
    descripcion: str(p.descripcion),
    luz: str(p.luz),
    riego: str(p.riego),
    etiqueta: str(p.etiqueta),
    portada: rel(p.portada) || 'img/logo.jpg',
    fotos: lista(p.fotos).map(rel),
    destacado: p.destacado === true,
    orden: num(p.orden, 1000),
  };
}).sort((a, b) => (b.destacado - a.destacado) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));

if (productos.length > 10) console.warn(`⚠️  Hay ${productos.length} productos visibles: la demo se pensó para 10 o menos`);

// Tarjetas con foto chica; la ficha usa una versión grande (1400 px)
await Promise.all(productos.map(async (p, i) => {
  p.mini = await optimizar(p.portada, i === 0 ? 1100 : 700);
  p.galeria = await Promise.all([p.portada, ...p.fotos].map((f) => optimizar(f, 1400)));
}));

const testimonios = (Array.isArray(testimoniosData.testimonios) ? testimoniosData.testimonios : [])
  .map((t) => ({ texto: str(t && t.texto), nombre: str(t && t.nombre), detalle: str(t && t.detalle) })).filter((t) => t.texto && t.nombre);
const cifras = (Array.isArray(ajustes.cifras) ? ajustes.cifras : [])
  .map((c) => ({ numero: Math.max(0, Math.round(num(c && c.numero, 0))), texto: str(c && c.texto) }))
  .filter((c) => c.texto && c.numero).slice(0, 4);

const categorias = [...new Set(productos.map((p) => p.categoria))];
const FLYER_ON = flyer.mostrar === true && rel(flyer.imagen) && existsSync(join(ROOT, rel(flyer.imagen)));
console.log(`✅ datos: ${productos.length} productos (${productos.filter((p) => p.precio).length} con precio), ${categorias.length} categorías, ${testimonios.length} testimonios, horario ${hayHorario ? 'sí' : 'no'}, flyer ${FLYER_ON ? 'sí' : 'no'}`);

// ---------- 2. HTML de las secciones ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const clp = (n) => `$${miles(n)}`;
const pad = (n) => String(n).padStart(2, '0');
const msgProducto = (p) => `Hola Vive Viveros 🌿 Quiero info de *${p.nombre}*${p.precio ? ` (${clp(p.precio)})` : ''} 👋`;

const productoHtml = (p, i) => `
        <article class="planta${i === 0 ? ' planta--hero' : ''}" data-cat="${esc(p.categoria)}" data-reveal style="--d:${(i % 3) * 90}ms">
          <button type="button" class="planta__btn" data-planta="${esc(p.id)}" aria-label="Ver ficha de ${esc(p.nombre)}">
            <span class="planta__foto">
              <img src="${esc(p.mini)}" alt="${esc(p.nombre)} en Vive Viveros" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">
              ${p.etiqueta ? `<span class="planta__cinta">${esc(p.etiqueta)}</span>` : ''}
              ${p.galeria.length > 1 ? `<span class="planta__fotos">${p.galeria.length} fotos</span>` : ''}
            </span>
            ${i === 0 && p.descripcion ? `<span class="planta__desc">${esc(p.descripcion)}</span>` : ''}
            <span class="tag">
              <span class="tag__ojal" aria-hidden="true"></span>
              <small class="tag__cat">${pad(i + 1)} · ${esc(p.categoria)}</small>
              <strong class="tag__nombre">${esc(p.nombre)}</strong>
              <span class="tag__precio">${p.precio ? esc(clp(p.precio)) : 'Consultar precio'}</span>
            </span>
          </button>
          <a class="planta__wa" href="${esc(wa(msgProducto(p)))}" target="_blank" rel="noopener">${T.whatsapp ? `${p.precio ? 'Reservar' : 'Cotizar'} por WhatsApp` : 'Consultar por Instagram'}</a>
        </article>`;

const filtrosHtml = ['Todas', ...categorias].map((c, i) =>
  `<button type="button" class="filtro${i === 0 ? ' is-on' : ''}" data-filtro="${esc(i === 0 ? '*' : c)}" aria-pressed="${i === 0}">${esc(c)}</button>`).join('');

const cifraHtml = (c, i) => `
          <li data-reveal style="--d:${i * 80}ms"><strong data-count="${c.numero}">${miles(c.numero)}</strong><span>${esc(c.texto)}</span></li>`;

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

// ---------- 3. Marcadores ----------
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const F_TITULOS = fuentes.titulos || 'Fraunces';
const F_TEXTO = fuentes.texto || 'Figtree';
const F_MANO = fuentes.mano || 'Caveat';
const fam = (f) => encodeURIComponent(f).replace(/%20/g, '+');
const heroFoto = rel(ajustes.hero_foto) || (productos[0] && productos[0].portada) || 'img/logo.jpg';
const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro} en ${T.ciudad}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || str(ajustes.hero_bajada);
const mapaQ = encodeURIComponent(T.direccion);
const flyerImg = FLYER_ON ? await optimizar(rel(flyer.imagen), 1000) : '';

const VARS = {
  NOMBRE: T.nombre, LEMA: T.lema, RUBRO: T.rubro,
  SEO_TITULO, SEO_DESCRIPCION,
  CIUDAD: T.ciudad, REGION: T.region, EMAIL: T.email, INSTAGRAM: T.instagram, IG_URL,
  CATALOGO: T.catalogo, MAYORISTA: T.mayorista,
  WHATSAPP: T.whatsapp,
  WA_LINK: wa(T.mensaje),
  WA_MAYOR: wa('Hola Vive Viveros 🌿 Tengo un negocio y quiero consultar *precios por mayor* 📦'),
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
  FILTROS: categorias.length > 1 ? '1' : '', N_PRODUCTOS: String(productos.length),
  FLYER: FLYER_ON ? '1' : '', FLYER_IMG: flyerImg, FLYER_TITULO: str(flyer.titulo), FLYER_TEXTO: str(flyer.texto),
  FLYER_LINK: wa(str(flyer.mensaje_whatsapp) || `Hola Vive Viveros 🌿 Vi la promo${flyer.titulo ? ` *${str(flyer.titulo)}*` : ''} en la web 👋`),
  FUENTES_URL: `https://fonts.googleapis.com/css2?family=${fam(F_TITULOS)}:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=${fam(F_TEXTO)}:wght@400;500;600;700&family=${fam(F_MANO)}:wght@500;700&display=swap`,
  FUENTE_TITULOS: F_TITULOS, FUENTE_TEXTO: F_TEXTO, FUENTE_MANO: F_MANO,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`, ANIO: String(new Date().getFullYear()),
  COLOR_TINTA: colores.tinta, COLOR_HOJA: colores.hoja, COLOR_HOJA_OSCURA: colores.hoja_oscura, COLOR_BROTE: colores.brote,
  COLOR_TERRACOTA: colores.terracota, COLOR_PAPEL: colores.papel, COLOR_CREMA: colores.crema, COLOR_LINEA: colores.linea,
  // Solo lo que necesita el navegador (app.js)
  SITIO_JSON: JSON.stringify({
    whatsapp: T.whatsapp,
    ig: IG_URL,
    horario: horario.map((d) => d.tramos),
    popup: FLYER_ON && flyer.popup === true,
    productos: Object.fromEntries(productos.map((p) => [p.id, {
      n: p.nombre, c: p.categoria, p: p.precio ? clp(p.precio) : '', d: p.descripcion, l: p.luz, r: p.riego, f: p.galeria,
    }])),
  }).replace(/</g, '\\u003c'),
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
    return escape && key !== 'SITIO_JSON' ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}

// ---------- 4. SEO ----------
const OG_IMAGE = abs(heroFoto);
const DIA_SCHEMA = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const geo = config.geo || {};
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': str(config.schema_tipo) || 'GardenStore',
  '@id': `${SITE}/#vivero`,
  name: T.nombre,
  slogan: T.lema || undefined,
  description: SEO_DESCRIPCION,
  url: `${SITE}/`,
  logo: abs('img/logo.jpg'),
  image: [OG_IMAGE, ...productos.slice(0, 4).map((p) => abs(p.portada))],
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
  sameAs: [IG_URL, T.catalogo].filter(Boolean),
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Plantas',
    itemListElement: productos.map((p) => ({
      '@type': 'Offer',
      price: p.precio || undefined,
      priceCurrency: p.precio ? 'CLP' : undefined,
      availability: 'https://schema.org/InStock',
      itemOffered: { '@type': 'Product', name: p.nombre, category: p.categoria, description: p.descripcion || undefined, image: abs(p.portada) },
    })),
  },
};

const head = `<link rel="canonical" href="${SITE}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/">
  <meta property="og:title" content="${esc(SEO_TITULO)}">
  <meta property="og:description" content="${esc(SEO_DESCRIPCION)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

// ---------- 5. dist/ ----------
const BLOQUES = {
  '<!-- PRODUCTOS -->': productos.map(productoHtml).join(''),
  '<!-- FILTROS -->': filtrosHtml,
  '<!-- CIFRAS -->': cifras.map(cifraHtml).join(''),
  '<!-- TESTIMONIOS -->': testimonios.map(testimonioHtml).join(''),
  '<!-- HORARIO_DIAS -->': horarioHtml,
  '<!-- MARQUESINA -->': [...productos, ...productos].map((p) => `<span>${esc(p.nombre)}</span>`).join(''),
  '<!-- OPCIONES_PLANTAS -->': productos.map((p) => `<option>${esc(p.nombre)}</option>`).join(''),
  '<!-- ZONAS -->': T.zonas.map((z) => `<option>${esc(z)}</option>`).join(''),
};
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', ...Object.keys(BLOQUES)]) {
  if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en index.html`);
}
html = render(html, 'index.html', true).replace(/<!-- SEO:HEAD[^>]*-->/, head);
for (const [marker, contenido] of Object.entries(BLOQUES)) html = html.replaceAll(marker, contenido);

cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(ROOT, 'data'), join(DIST, 'data'), { recursive: true });
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = render(readFileSync(join(ROOT, 'styles.css'), 'utf8'), 'styles.css', false);
const js = render(readFileSync(join(ROOT, 'app.js'), 'utf8'), 'app.js', false);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`)
  .replace('src="app.js"', `src="app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) console.warn('⚠️  Falta img/logo.jpg (logo)');
console.log(`✅ sitio listo en dist/ para ${SITE}`);
