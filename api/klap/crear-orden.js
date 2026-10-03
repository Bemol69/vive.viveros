// POST /api/klap/crear-orden  { codigo, items: [{id, q}], datos }  →  { order_id, redirect_url }
// Calcula el total con los precios del catálogo del servidor y crea la orden en Klap.
const K = require('../../lib/klap.js');

module.exports = async function crearOrden(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método no permitido' }); }
  const cfg = K.configuracion();
  if (!cfg.apikey || !K.pagoActivo()) return res.status(503).json({ error: 'El pago con tarjeta no está disponible. Envía tu pedido por WhatsApp.' });
  const origen = K.origenDe(req);
  if (!origen) return res.status(400).json({ error: 'Solicitud inválida.' });

  const armado = K.armarOrden({ cuerpo: K.cuerpoDe(req), productos: K.productosActuales(), origen, cfg });
  if (armado.error) return res.status(400).json({ error: armado.error });

  try {
    const r = await K.llamar(cfg, '/payment-gateway/v1/orders', { method: 'POST', body: armado.orden });
    if (r.ok && r.json && r.json.order_id && r.json.redirect_url) {
      console.log(`[klap] orden creada ${r.json.order_id} ref ${armado.referencia} total ${armado.total}`);
      return res.status(200).json({ order_id: r.json.order_id, redirect_url: r.json.redirect_url, reference_id: armado.referencia });
    }
    console.error(`[klap] no se creó la orden (${r.status}): ${r.texto}`);
    return res.status(502).json({ error: 'Klap no pudo iniciar el pago. Intenta de nuevo o envía el pedido por WhatsApp.' });
  } catch (e) {
    console.error('[klap] error al crear la orden:', e && e.message);
    return res.status(504).json({ error: 'Klap no respondió a tiempo. Intenta de nuevo o envía el pedido por WhatsApp.' });
  }
};
