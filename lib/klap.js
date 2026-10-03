// Integración con Klap Checkout (API de Pagos). Documentación: https://developers.klap.cl/documentacion-api
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   KLAP_APIKEY     API key que entrega Klap (sandbox o producción). Sin ella, el pago con tarjeta queda apagado.
//   KLAP_AMBIENTE   "sandbox" (por defecto) o "produccion"
//   KLAP_API_URL    opcional: URL base si Klap entrega otra (manda sobre KLAP_AMBIENTE)
//   KLAP_METODOS    opcional: medios separados por coma (por defecto "*" = todos los habilitados)
//   KLAP_EMAIL_AVISO opcional: correo donde Klap avisa cada pago al vivero
const { createHash, timingSafeEqual, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const N = require('../nucleo.js');
const { leerProductos, mapaPrecios } = require('./catalogo.js');

const URLS = {
  sandbox: 'https://api-pasarela-sandbox.mcdesaqa.cl',
  // Confirmar con Klap al pasar a producción; se puede cambiar con KLAP_API_URL sin tocar código
  produccion: 'https://api.pasarela.multicaja.cl',
};
// VV_RAIZ solo lo usan las pruebas (catálogo de ejemplo); en Vercel es la carpeta del proyecto
const RAIZ = process.env.VV_RAIZ || join(__dirname, '..');

function configuracion(env = process.env) {
  const ambiente = env.KLAP_AMBIENTE === 'produccion' ? 'produccion' : 'sandbox';
  return {
    apikey: String(env.KLAP_APIKEY || '').trim(),
    ambiente,
    base: String(env.KLAP_API_URL || URLS[ambiente]).replace(/\/$/, ''),
    metodos: String(env.KLAP_METODOS || '*').split(',').map((s) => s.trim()).filter(Boolean),
    emailAviso: String(env.KLAP_EMAIL_AVISO || '').trim(),
  };
}

// El vivero enciende o apaga el pago con tarjeta en /admin (data/ajustes.json → pago_online)
function pagoActivo(raiz = RAIZ) {
  try { return JSON.parse(readFileSync(join(raiz, 'data', 'ajustes.json'), 'utf8')).pago_online === true; } catch { return false; }
}

// Firma que Klap manda en el header "Apikey" de los webhooks: sha256(reference_id + order_id + apikey)
const firma = (referenceId, orderId, apikey) => createHash('sha256').update(`${referenceId}${orderId}${apikey}`).digest('hex');
function firmaValida(header, cuerpo, apikey) {
  if (!header || !cuerpo || !apikey || !cuerpo.reference_id || !cuerpo.order_id) return false;
  const esperada = Buffer.from(firma(cuerpo.reference_id, cuerpo.order_id, apikey));
  const recibida = Buffer.from(String(header).trim().toLowerCase());
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

const limpiarTexto = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Arma el cuerpo de la orden con los precios del catálogo (los del navegador no se usan)
function armarOrden({ cuerpo, productos, origen, cfg }) {
  if (!cuerpo || typeof cuerpo !== 'object') return { error: 'Pedido inválido.' };
  if (!Array.isArray(cuerpo.items) || cuerpo.items.length > 200) return { error: 'Pedido inválido.' };
  const items = N.sanear(cuerpo.items, productos);
  if (!items.length) return { error: 'El pedido está vacío o sus productos ya no están en el catálogo.' };
  const datos = cuerpo.datos && typeof cuerpo.datos === 'object' ? cuerpo.datos : {};
  const cobro = N.lineasCobro(items, productos, N.esMayor(datos.compra));
  if (cobro.error) return { error: cobro.error };
  if (!(cobro.total > 0) || cobro.total > 20000000) return { error: 'El total del pedido no es válido para pago en línea.' };
  const codigo = /^VV-[0-9A-Z]{4}$/.test(cuerpo.codigo) ? cuerpo.codigo : N.codigoPedido();
  // Única por intento: si el cliente reintenta, no choca con la orden anterior
  const referencia = `${codigo}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const nombre = limpiarTexto(datos.nombre, 80).split(' ');
  const customs = [
    { key: 'tarjetas_expiration_minutes', value: '30' },
    { key: 'notify_payment_merchant', value: cfg.emailAviso ? 'true' : 'false' },
  ];
  if (cfg.emailAviso) customs.push({ key: 'notify_payment_email_merchant', value: cfg.emailAviso });
  return {
    referencia,
    total: cobro.total,
    orden: {
      reference_id: referencia,
      description: `Pedido ${codigo} · Vive Viveros`,
      amount: { currency: 'CLP', total: cobro.total, details: { subtotal: cobro.total, fee: 0, tax: 0 } },
      items: cobro.lineas,
      methods: cfg.metodos,
      user: { first_name: nombre[0] || 'Cliente', last_name: nombre.slice(1).join(' ') },
      urls: {
        return_url: `${origen}/pago?ref=${encodeURIComponent(referencia)}`,
        cancel_url: `${origen}/pago?ref=${encodeURIComponent(referencia)}&cancelado=1`,
      },
      webhooks: {
        webhook_validation: `${origen}/api/klap/webhook?evento=validation`,
        webhook_confirm: `${origen}/api/klap/webhook?evento=confirm`,
        webhook_reject: `${origen}/api/klap/webhook?evento=reject`,
      },
      customs,
    },
  };
}

// Llamada a Klap con tiempo máximo (que una caída de Klap no deje colgada la página)
async function llamar(cfg, ruta, { method = 'GET', body, fetchImpl = fetch, ms = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetchImpl(`${cfg.base}${ruta}`, {
      method,
      headers: { apikey: cfg.apikey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
    return { ok: r.ok, status: r.status, json, texto: texto.slice(0, 500) };
  } finally {
    clearTimeout(t);
  }
}

// Origen público del sitio (para las URLs de vuelta y los webhooks)
function origenDe(req, env = process.env) {
  if (env.SITIO_URL) return env.SITIO_URL.replace(/\/$/, '');
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return '';
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

// Cuerpo JSON aunque llegue como texto (Vercel lo parsea; el servidor local también)
function cuerpoDe(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return null; }
}

const productosActuales = (raiz = RAIZ) => mapaPrecios(leerProductos(raiz));

module.exports = { URLS, configuracion, pagoActivo, firma, firmaValida, armarOrden, llamar, origenDe, cuerpoDe, productosActuales };
