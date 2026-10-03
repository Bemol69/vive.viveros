// GET /api/klap/estado?order_id=...  →  { status, reference_id, total }
// La página de vuelta (pago.html) consulta aquí el estado real de la orden en Klap.
const K = require('../../lib/klap.js');

module.exports = async function estado(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Método no permitido' }); }
  const cfg = K.configuracion();
  if (!cfg.apikey) return res.status(503).json({ error: 'El pago con tarjeta no está configurado' });
  const id = String((req.query && req.query.order_id) || '');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) return res.status(400).json({ error: 'Orden inválida' });
  try {
    const r = await K.llamar(cfg, `/payment-gateway/v1/orders/${encodeURIComponent(id)}`);
    if (!r.ok || !r.json) {
      console.error(`[klap] estado ${id} (${r.status}): ${r.texto}`);
      return res.status(r.status === 404 ? 404 : 502).json({ error: 'No pudimos consultar el pago' });
    }
    const total = r.json.amount && r.json.amount.total;
    return res.status(200).json({ status: String(r.json.status || 'pending'), reference_id: r.json.reference_id || '', total: Number(total) || 0 });
  } catch (e) {
    console.error('[klap] error al consultar estado:', e && e.message);
    return res.status(504).json({ error: 'Klap no respondió a tiempo' });
  }
};
