// Página de vuelta desde Klap. Consulta el estado REAL de la orden en el servidor (api/klap/estado),
// porque la URL de vuelta la puede escribir cualquiera. Si quedó pagada, vacía el pedido y ofrece avisar por WhatsApp.
(() => {
  const raiz = document.querySelector('[data-pago]');
  if (!raiz) return;
  const $ = (s) => raiz.querySelector(s);
  const ver = (estado) => raiz.querySelectorAll('[data-estado-pago]').forEach((el) => { el.hidden = el.dataset.estadoPago !== estado; });
  let pago = null;
  try { pago = JSON.parse(localStorage.getItem('vv-pago')); } catch { pago = null; }
  if (!pago || !pago.order_id) { ver('nada'); return; }
  raiz.querySelectorAll('[data-pago-codigo]').forEach((el) => { el.textContent = pago.codigo; });

  let intentos = 0;
  async function consultar() {
    ver('cargando');
    try {
      const r = await fetch(`/api/klap/estado?order_id=${encodeURIComponent(pago.order_id)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No pudimos consultar el pago');
      if (j.status === 'completed') {
        try { localStorage.setItem('vv-pedido', '[]'); localStorage.removeItem('vv-pago'); } catch { /* sin almacenamiento */ }
        const wa = raiz.dataset.whatsapp;
        $('[data-pago-wa]').href = wa ? `https://api.whatsapp.com/send?phone=${wa}&text=${encodeURIComponent(pago.mensaje || `Hola, pagué el pedido ${pago.codigo}`)}` : './';
        ver('ok');
      } else if (j.status === 'pending') {
        // Klap a veces tarda unos segundos en confirmar: reintenta solo un par de veces
        if (++intentos < 4) setTimeout(consultar, 3000); else ver('pendiente');
      } else {
        ver('error');
      }
    } catch (e) {
      $('[data-pago-motivo]').textContent = `${e.message}. Si se hizo un cargo, escríbenos con tu código ${pago.codigo} y lo revisamos.`;
      ver('error');
    }
  }
  $('[data-pago-reintentar]').addEventListener('click', () => { intentos = 0; consultar(); });
  consultar();
})();
