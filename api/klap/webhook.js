// POST /api/klap/webhook?evento=validation|confirm|reject
// Klap avisa aquí cuando una orden se paga o se rechaza. Hay que responder 2xx con JSON en menos de 10 s;
// si no, Klap reversa el pago. Las notificaciones de pago/rechazo se validan con la firma del header "Apikey".
const K = require('../../lib/klap.js');

module.exports = async function webhook(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método no permitido' }); }
  const evento = String((req.query && req.query.evento) || '');
  const cuerpo = K.cuerpoDe(req);
  if (!cuerpo || !['validation', 'confirm', 'reject'].includes(evento)) return res.status(400).json({ error: 'Solicitud inválida' });

  if (evento === 'validation') return res.status(200).json(cuerpo);

  const cfg = K.configuracion();
  const header = req.headers && (req.headers.apikey || req.headers.Apikey);
  if (!K.firmaValida(header, cuerpo, cfg.apikey)) {
    console.warn(`[klap] webhook ${evento} con firma inválida (orden ${cuerpo.order_id || '?'})`);
    return res.status(401).json({ error: 'Firma inválida' });
  }
  // Queda en los logs de Vercel (Klap además avisa por correo si KLAP_EMAIL_AVISO está configurado)
  console.log(`[klap] ${evento === 'confirm' ? 'PAGADA' : 'RECHAZADA'} orden ${cuerpo.order_id} ref ${cuerpo.reference_id} monto ${cuerpo.amount || '?'} ${cuerpo.brand || ''} ${cuerpo.last_digits ? `****${cuerpo.last_digits}` : ''}`);
  return res.status(200).json({ status: 'ok' });
};
