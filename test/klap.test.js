// Pruebas del pago con Klap contra un Klap falso (servidor local): crear orden, consultar estado y webhooks.
// No se conecta a Klap de verdad. Correr: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const http = require('node:http');

// Catálogo de ejemplo en una carpeta temporal (no se toca data/ del proyecto)
const raiz = mkdtempSync(join(tmpdir(), 'vv-klap-'));
mkdirSync(join(raiz, 'data', 'productos'), { recursive: true });
const producto = (id, p) => writeFileSync(join(raiz, 'data', 'productos', `${id}.json`), JSON.stringify(p));
producto('limonero', { nombre: 'Limonero', categoria: 'Frutales', precio: 8000 });
producto('dracena', { nombre: 'Dracena', categoria: 'Interior', precio: 10000, precio_mayor: 7900 });
producto('sin-precio', { nombre: 'Olivo', categoria: 'Árboles' });
producto('agotado', { nombre: 'Arce', categoria: 'Árboles', precio: 30000, agotado: true });
producto('oculto', { nombre: 'Oculto', precio: 1000, visible: false });
writeFileSync(join(raiz, 'data', 'productos', 'roto.json'), '{ esto no es json');
const activar = (si) => writeFileSync(join(raiz, 'data', 'ajustes.json'), JSON.stringify({ pago_online: si }));
activar(true);

// Klap falso
const recibidas = [];
let respuestaKlap = (req, cuerpo) => ({ status: 201, json: { order_id: 'ORD123', redirect_url: 'https://pagos.klap.test/order/ORD123', status: 'pending' } });
const klap = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const cuerpo = b ? JSON.parse(b) : null;
    recibidas.push({ method: req.method, url: req.url, apikey: req.headers.apikey, cuerpo });
    const r = respuestaKlap(req, cuerpo);
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.json));
  });
});

let K, crearOrden, estado, webhook;
test.before(async () => {
  await new Promise((ok) => klap.listen(0, ok));
  Object.assign(process.env, { VV_RAIZ: raiz, KLAP_APIKEY: 'CLAVE-SECRETA', KLAP_API_URL: `http://127.0.0.1:${klap.address().port}`, KLAP_EMAIL_AVISO: 'vivero@ejemplo.cl' });
  K = require('../lib/klap.js');
  crearOrden = require('../api/klap/crear-orden.js');
  estado = require('../api/klap/estado.js');
  webhook = require('../api/klap/webhook.js');
});
test.after(() => { klap.close(); rmSync(raiz, { recursive: true, force: true }); });

// req/res como los entrega Vercel
function llamar(fn, { method = 'POST', body, query = {}, headers = {} } = {}) {
  return new Promise((ok) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { ok({ status: this.statusCode, body: o }); return this; } };
    fn({ method, body, query, headers: { host: 'vive-viveros.vercel.app', ...headers } }, res);
  });
}

test('crear orden: cobra con los precios del servidor, no con los del navegador', async () => {
  recibidas.length = 0;
  const r = await llamar(crearOrden, { body: { codigo: 'VV-AB12', items: [{ id: 'limonero', q: 2, precio: 1 }, { id: 'dracena', q: 1 }], datos: { nombre: 'Camila Rojas' } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.order_id, 'ORD123');
  assert.equal(r.body.redirect_url, 'https://pagos.klap.test/order/ORD123');
  const o = recibidas[0];
  assert.equal(o.url, '/payment-gateway/v1/orders');
  assert.equal(o.apikey, 'CLAVE-SECRETA');
  assert.equal(o.cuerpo.amount.total, 26000);
  assert.equal(o.cuerpo.amount.currency, 'CLP');
  assert.deepEqual(o.cuerpo.items.map((i) => [i.code, i.unit_price, i.quantity, i.price]), [['limonero', 8000, 2, 16000], ['dracena', 10000, 1, 10000]]);
  assert.match(o.cuerpo.reference_id, /^VV-AB12-[0-9A-F]{6}$/);
  assert.equal(o.cuerpo.urls.return_url, `https://vive-viveros.vercel.app/pago?ref=${o.cuerpo.reference_id}`);
  assert.equal(o.cuerpo.webhooks.webhook_confirm, 'https://vive-viveros.vercel.app/api/klap/webhook?evento=confirm');
  assert.equal(o.cuerpo.user.first_name, 'Camila');
  assert.ok(o.cuerpo.customs.some((c) => c.key === 'notify_payment_email_merchant' && c.value === 'vivero@ejemplo.cl'));
});

test('crear orden: precio por mayor cuando el cliente compra por mayor', async () => {
  recibidas.length = 0;
  const r = await llamar(crearOrden, { body: { items: [{ id: 'dracena', q: 3 }], datos: { compra: 'Por mayor (tengo negocio)' } } });
  assert.equal(r.status, 200);
  assert.equal(recibidas[0].cuerpo.amount.total, 23700);
});

test('crear orden: rechaza pedidos que no se pueden cobrar', async () => {
  for (const [items, msg] of [
    [[], /vacío/],
    [[{ id: 'sin-precio', q: 1 }], /no tiene precio/],
    [[{ id: 'agotado', q: 1 }], /agotado/],
    [[{ id: 'oculto', q: 1 }], /vacío|ya no están/],
    [[{ id: 'roto', q: 1 }], /vacío|ya no están/],
    ['basura', /inválido/],
    [Array.from({ length: 201 }, () => ({ id: 'limonero', q: 1 })), /inválido/],
  ]) {
    const r = await llamar(crearOrden, { body: { items } });
    assert.equal(r.status, 400, JSON.stringify(items).slice(0, 40));
    assert.match(r.body.error, msg);
  }
  const r = await llamar(crearOrden, { body: '{ no es json' });
  assert.equal(r.status, 400);
});

test('crear orden: solo POST, y apagado si el vivero no lo activó', async () => {
  assert.equal((await llamar(crearOrden, { method: 'GET' })).status, 405);
  activar(false);
  const r = await llamar(crearOrden, { body: { items: [{ id: 'limonero', q: 1 }] } });
  assert.equal(r.status, 503);
  activar(true);
});

test('crear orden: si Klap falla, responde un error claro (sin colgarse)', async () => {
  respuestaKlap = () => ({ status: 500, json: { code: '500001', message: 'Could not create order.' } });
  const r = await llamar(crearOrden, { body: { items: [{ id: 'limonero', q: 1 }] } });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /WhatsApp/);
  respuestaKlap = () => ({ status: 201, json: { order_id: 'ORD123', redirect_url: 'https://pagos.klap.test/order/ORD123' } });
});

test('crear orden: Host falso no se usa para las URLs', async () => {
  const r = await llamar(crearOrden, { body: { items: [{ id: 'limonero', q: 1 }] }, headers: { host: 'evil.com/<script>' } });
  assert.equal(r.status, 400);
});

test('estado: consulta la orden en Klap y valida el id', async () => {
  respuestaKlap = (req) => ({ status: 200, json: { order_id: 'ORD123', reference_id: 'VV-AB12-ABCDEF', status: 'completed', amount: { total: 26000 } } });
  const r = await llamar(estado, { method: 'GET', query: { order_id: 'ORD123' } });
  assert.deepEqual(r.body, { status: 'completed', reference_id: 'VV-AB12-ABCDEF', total: 26000 });
  assert.equal((await llamar(estado, { method: 'GET', query: { order_id: '../../x' } })).status, 400);
  assert.equal((await llamar(estado, { method: 'GET', query: {} })).status, 400);
  respuestaKlap = () => ({ status: 404, json: { message: 'not found' } });
  assert.equal((await llamar(estado, { method: 'GET', query: { order_id: 'NOPE1' } })).status, 404);
});

test('webhook: acepta la firma correcta de Klap y rechaza las falsas', async () => {
  const cuerpo = { order_id: 'ORD123', reference_id: 'VV-AB12-ABCDEF', amount: '26000', brand: 'VISA', last_digits: '4242' };
  const buena = K.firma(cuerpo.reference_id, cuerpo.order_id, 'CLAVE-SECRETA');
  const ok = await llamar(webhook, { body: cuerpo, query: { evento: 'confirm' }, headers: { apikey: buena } });
  assert.deepEqual([ok.status, ok.body], [200, { status: 'ok' }]);
  const mayus = await llamar(webhook, { body: cuerpo, query: { evento: 'reject' }, headers: { apikey: buena.toUpperCase() } });
  assert.equal(mayus.status, 200);
  const mala = await llamar(webhook, { body: cuerpo, query: { evento: 'confirm' }, headers: { apikey: 'x'.repeat(64) } });
  assert.equal(mala.status, 401);
  const sin = await llamar(webhook, { body: cuerpo, query: { evento: 'confirm' } });
  assert.equal(sin.status, 401);
  const otraOrden = await llamar(webhook, { body: { ...cuerpo, order_id: 'OTRA' }, query: { evento: 'confirm' }, headers: { apikey: buena } });
  assert.equal(otraOrden.status, 401);
});

test('webhook: validación responde el mismo cuerpo; eventos desconocidos y GET se rechazan', async () => {
  const v = await llamar(webhook, { body: { reference_id: 'R1' }, query: { evento: 'validation' } });
  assert.deepEqual([v.status, v.body], [200, { reference_id: 'R1' }]);
  assert.equal((await llamar(webhook, { body: {}, query: { evento: 'otro' } })).status, 400);
  assert.equal((await llamar(webhook, { method: 'GET', query: { evento: 'confirm' } })).status, 405);
});

test('configuración: sandbox por defecto y producción con KLAP_AMBIENTE', () => {
  assert.equal(K.configuracion({}).base, K.URLS.sandbox);
  assert.equal(K.configuracion({ KLAP_AMBIENTE: 'produccion' }).base, K.URLS.produccion);
  assert.equal(K.configuracion({ KLAP_API_URL: 'https://otra.klap.cl/' }).base, 'https://otra.klap.cl');
  assert.deepEqual(K.configuracion({ KLAP_METODOS: 'tarjetas, edenred' }).metodos, ['tarjetas', 'edenred']);
});
