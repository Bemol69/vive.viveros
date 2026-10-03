// Pruebas del sitio completo: arma la web en una carpeta temporal y revisa que no falte nada
// (fotos, scripts, marcadores sin reemplazar, datos para Google, panel /admin) y que el servidor local responda.
// Correr: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { leerProductos } = require('../lib/catalogo.js');
const DIST = mkdtempSync(join(tmpdir(), 'vv-dist-'));
test.after(() => rmSync(DIST, { recursive: true, force: true }));

const leer = (f) => readFileSync(join(DIST, f), 'utf8');
let build;
test.before(() => {
  build = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { env: { ...process.env, VV_DIST: DIST }, encoding: 'utf8' });
});

test('el build termina sin errores', () => {
  assert.equal(build.status, 0, build.stderr || build.stdout);
  for (const f of ['index.html', 'catalogo.html', 'pago.html', 'styles.css', 'nucleo.js', 'tienda.js', 'app.js', 'catalogo.js', 'pago.js', 'robots.txt', 'sitemap.xml', 'admin/config.yml', 'admin/index.html']) {
    assert.ok(existsSync(join(DIST, f)), `falta dist/${f}`);
  }
});

test('todos los productos de data/ son JSON válidos y sus fotos existen', () => {
  const dir = join(ROOT, 'data', 'productos');
  const problemas = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let p;
    try { p = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { problemas.push(`${f}: JSON dañado`); continue; }
    if (!String(p.nombre || '').trim()) problemas.push(`${f}: sin nombre`);
    if (p.precio != null && p.precio !== '' && !(Number.isInteger(p.precio) && p.precio >= 0)) problemas.push(`${f}: precio inválido ${p.precio}`);
    for (const foto of [p.portada, ...(p.fotos || [])].filter(Boolean)) {
      if (!existsSync(join(ROOT, String(foto).replace(/^\//, '')))) problemas.push(`${f}: no existe ${foto}`);
    }
  }
  assert.deepEqual(problemas, []);
});

test('las páginas no tienen marcadores sin reemplazar', () => {
  for (const f of ['index.html', 'catalogo.html', 'pago.html', 'admin/config.yml', 'styles.css']) {
    const t = leer(f);
    assert.doesNotMatch(t, /%%[A-Z0-9_]+%%/, f);
    assert.doesNotMatch(t, /<!-- (SI|PARCIAL):/, f);
  }
});

test('todas las fotos, estilos y scripts que usan las páginas existen', () => {
  const faltan = [];
  for (const pagina of ['index.html', 'catalogo.html', 'pago.html']) {
    const html = leer(pagina);
    for (const [, url] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^(https?:|mailto:|tel:|data:)/.test(url) || url === './' || url === 'catalogo' || url.startsWith('catalogo?') || url.startsWith('./#')) continue;
      const archivo = url.split('?')[0].replace(/&amp;/g, '&');
      if (!existsSync(join(DIST, archivo))) faltan.push(`${pagina}: ${url}`);
    }
  }
  assert.deepEqual(faltan, []);
});

test('el catálogo tiene todos los productos (en el HTML para Google y en los datos del navegador)', () => {
  const html = leer('catalogo.html');
  const visibles = leerProductos(ROOT);
  const tarjetas = [...html.matchAll(/<article class="prod[^"]*" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(tarjetas.length, visibles.length);
  assert.equal(new Set(tarjetas).size, tarjetas.length, 'hay productos repetidos');
  const sitio = JSON.parse(html.match(/window\.SITIO = (.+?);<\/script>/)[1]);
  assert.equal(Object.keys(sitio.productos).length, visibles.length);
  for (const [id, p] of Object.entries(sitio.productos)) {
    assert.ok(p.n && typeof p.v === 'number' && Array.isArray(p.f) && p.f.length, `datos incompletos de ${id}`);
    for (const f of [p.m, ...p.f]) assert.ok(existsSync(join(DIST, f)), `${id}: falta ${f}`);
  }
  // Los chips de categoría suman el total
  const chips = [...html.matchAll(/data-chip="([^"]*)"[^>]*>[^<]*<span>(\d+)<\/span>/g)];
  const suma = chips.filter(([, c]) => c).reduce((s, [, , n]) => s + Number(n), 0);
  assert.equal(suma, visibles.length);
});

test('datos para Google: JSON-LD válido, canonical, sitemap y robots', () => {
  for (const f of ['index.html', 'catalogo.html']) {
    const html = leer(f);
    const bloques = [...html.matchAll(/<script type="application\/ld\+json">(.+?)<\/script>/g)];
    assert.ok(bloques.length, `${f} sin datos estructurados`);
    bloques.forEach(([, j]) => JSON.parse(j));
    assert.match(html, /<link rel="canonical" href="https:\/\//);
  }
  const lista = JSON.parse(leer('catalogo.html').match(/<script type="application\/ld\+json">(.+?)<\/script>/)[1]);
  assert.equal(lista['@type'], 'ItemList');
  assert.equal(lista.itemListElement.length, leerProductos(ROOT).length);
  assert.match(leer('sitemap.xml'), /\/catalogo<\/loc>/);
  assert.match(leer('robots.txt'), /Disallow: \/admin\//);
});

test('panel /admin: las categorías del selector incluyen todas las usadas', () => {
  const yml = leer('admin/config.yml');
  const opciones = JSON.parse(yml.match(/^\s+options: (\[.*\])$/m)[1]);
  for (const p of leerProductos(ROOT)) assert.ok(opciones.includes(p.categoria), `falta la categoría ${p.categoria}`);
  assert.match(yml, /repo: \S+\/\S+/);
});

test('lector de productos: tolera archivos dañados, ocultos y datos raros', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'vv-cat-'));
  const d = join(raiz, 'data', 'productos');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'bueno.json'), JSON.stringify({ nombre: ' Limonero ', precio: '8000', precio_mayor: 9000, categoria: '' }));
  writeFileSync(join(d, 'roto.json'), '{');
  writeFileSync(join(d, 'oculto.json'), JSON.stringify({ nombre: 'X', visible: false }));
  writeFileSync(join(d, 'sin-nombre.json'), JSON.stringify({ precio: 100 }));
  writeFileSync(join(d, 'nulo.json'), 'null');
  writeFileSync(join(d, 'negativo.json'), JSON.stringify({ nombre: 'Raro', precio: -5, fotos: 'no-lista' }));
  const avisos = [];
  const ps = leerProductos(raiz, { avisar: (m) => avisos.push(m) });
  rmSync(raiz, { recursive: true, force: true });
  assert.deepEqual(ps.map((p) => p.id).sort(), ['bueno', 'negativo']);
  const bueno = ps.find((p) => p.id === 'bueno');
  assert.equal(bueno.nombre, 'Limonero');
  assert.equal(bueno.precio, 8000);
  assert.equal(bueno.precioMayor, 0, 'un precio por mayor más caro que el normal se ignora');
  assert.equal(bueno.categoria, 'Otros');
  assert.equal(ps.find((p) => p.id === 'negativo').precio, 0);
  assert.deepEqual(ps.find((p) => p.id === 'negativo').fotos, []);
  assert.equal(avisos.length, 1);
});

test('servidor local: URLs limpias, archivos y funciones de pago', async () => {
  process.env.VV_DIST = DIST;
  delete process.env.KLAP_APIKEY;
  const { crearServidor } = await import('../scripts/servir.mjs');
  const srv = crearServidor();
  await new Promise((ok) => srv.listen(0, ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const cat = await fetch(`${base}/catalogo`);
    assert.equal(cat.status, 200);
    assert.match(cat.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.match((await fetch(`${base}/nucleo.js`)).headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${base}/no-existe`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
    const pago = await fetch(`${base}/api/klap/crear-orden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"items":[]}' });
    assert.equal(pago.status, 503, 'sin API key, el pago con tarjeta debe estar apagado');
  } finally {
    srv.close();
  }
});
