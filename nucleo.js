// Lógica pura de la tienda (sin DOM): la usan el navegador (window.Nucleo),
// las funciones de pago en api/ y las pruebas (require('./nucleo.js')).
// Si cambias algo aquí, corre `npm test`.
(function (raiz, fabrica) {
  const N = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = N;
  else raiz.Nucleo = N;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX = 999;

  // "Limón Sutil " -> "limon sutil" (para buscar sin importar tildes ni mayúsculas)
  const normalizar = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();

  const miles = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const clp = (n) => `$${miles(n)}`;

  // Deja solo productos que existen, cantidades enteras entre 1 y MAX y sin repetidos
  function sanear(crudo, productos) {
    if (!Array.isArray(crudo) || !productos) return [];
    const vistos = new Map();
    for (const x of crudo) {
      if (!x || typeof x.id !== 'string' || !Object.prototype.hasOwnProperty.call(productos, x.id)) continue;
      const q = Math.floor(Number(x.q));
      if (!Number.isFinite(q) || q < 1) continue;
      const previo = vistos.get(x.id) || 0;
      vistos.set(x.id, Math.min(MAX, previo + q));
    }
    return [...vistos].map(([id, q]) => ({ id, q }));
  }

  // Precio que aplica: p.v = detalle, p.w = por mayor (si existe y el cliente compra por mayor). 0 = se cotiza
  const precio = (p, mayor) => (mayor && p.w > 0 ? p.w : p.v > 0 ? p.v : 0);
  const esMayor = (compra) => /mayor/i.test(String(compra || ''));

  // Totales del pedido
  function cuenta(items, productos, mayor = false) {
    let n = 0, total = 0, sinPrecio = 0;
    for (const x of items) {
      const p = productos[x.id];
      if (!p) continue;
      n += x.q;
      const v = precio(p, mayor);
      if (v > 0) total += v * x.q; else sinPrecio += x.q;
    }
    return { n, total, sinPrecio };
  }

  // Filtro y orden del catálogo. Todas las palabras buscadas deben aparecer (en cualquier orden).
  function filtrar(lista, { q = '', cat = '', orden = 'relevancia', disponibles = false } = {}) {
    const palabras = normalizar(q).split(' ').filter(Boolean);
    const salida = lista.filter((p) => {
      if (cat && p.c !== cat) return false;
      if (disponibles && p.a) return false;
      if (!palabras.length) return true;
      const texto = p._t || (p._t = normalizar(`${p.n} ${p.c} ${p.d || ''} ${p.e || ''}`));
      return palabras.every((w) => texto.includes(w));
    });
    const nombre = (a, b) => a.n.localeCompare(b.n, 'es');
    const precio = (p) => (p.v > 0 ? p.v : Infinity);
    const porOrden = {
      'a-z': nombre,
      'z-a': (a, b) => -nombre(a, b),
      'precio-asc': (a, b) => precio(a) - precio(b) || nombre(a, b),
      'precio-desc': (a, b) => (b.v || 0) - (a.v || 0) || nombre(a, b),
    };
    // Relevancia: disponibles primero; si hay búsqueda, los que empiezan con lo buscado van antes
    const inicio = palabras.join(' ');
    const relevancia = (a, b) => (a.a - b.a)
      || (inicio ? (normalizar(b.n).startsWith(inicio) - normalizar(a.n).startsWith(inicio)) : 0)
      || (a.o - b.o) || nombre(a, b);
    return salida.sort(porOrden[orden] || relevancia);
  }

  // "VV-4K2P": corto, fácil de dictar por teléfono
  function codigoPedido(ahora = Date.now(), azar = Math.random()) {
    const base = (Math.floor(ahora / 1000) * 7 + Math.floor(azar * 1296)).toString(36).toUpperCase();
    return `VV-${base.slice(-4).padStart(4, '0')}`;
  }

  // Mensaje de WhatsApp (con negritas/cursivas de WhatsApp y emojis)
  function mensajePedido({ codigo, items, productos, datos = {}, pagado = '' }) {
    const mayor = esMayor(datos.compra);
    const { total, sinPrecio } = cuenta(items, productos, mayor);
    const despacho = datos.entrega === 'despacho';
    const raya = '━━━━━━━━━━━━━━━';
    const falta = '_(por completar)_';
    const l = [`🌿 *PEDIDO VIVE VIVEROS · ${codigo}* 🌿`, raya];
    for (const x of items) {
      const p = productos[x.id];
      if (!p) continue;
      const v = precio(p, mayor);
      l.push(`🪴 *${x.q} × ${p.n}* — ${v > 0 ? clp(v * x.q) : 'precio a confirmar'}${mayor && p.w > 0 ? ' (precio por mayor)' : ''}`);
    }
    if (datos.encargo) l.push(`✍️ *También busco:* ${datos.encargo}`);
    if (items.length) l.push(raya, `💰 *Total:* ${clp(total)}${sinPrecio ? ' + plantas por cotizar' : ''}${despacho ? ' + despacho' : ''}`);
    if (pagado) l.push(`✅ *Pagado con tarjeta* (${pagado})`);
    l.push(raya);
    l.push(`🙋 *Nombre:* ${datos.nombre || falta}`);
    l.push(`🛒 *Compra:* ${datos.compra || 'Para mí (al detalle)'}`);
    if (despacho) {
      l.push('🚚 *Entrega:* Despacho a domicilio');
      l.push(`📍 *Comuna:* ${datos.comuna || falta}`);
      l.push(`🏠 *Dirección:* ${datos.direccion || falta}`);
    } else {
      l.push('🏡 *Entrega:* Retiro en el vivero');
    }
    if (!pagado && datos.pago) l.push(`💳 *Pago:* ${datos.pago}`);
    if (datos.nota) l.push(`📝 *Comentario:* ${datos.nota}`);
    l.push(raya, pagado ? '¡Hola! Ya pagué este pedido 🙌 ¿Coordinamos la entrega?' : '¡Hola! Quiero reservar este pedido 🙌 ¿Me confirman disponibilidad?');
    return l.join('\n');
  }

  // Líneas para el pago con tarjeta: solo productos con precio y disponibles.
  // Devuelve { error } si algo no se puede cobrar en línea.
  function lineasCobro(items, productos, mayor = false) {
    if (!items.length) return { error: 'El pedido está vacío.' };
    const lineas = [];
    let total = 0;
    for (const x of items) {
      const p = productos[x.id];
      if (!p) return { error: 'Un producto ya no está disponible. Recarga la página.' };
      if (p.a) return { error: `${p.n} está agotado.` };
      const v = precio(p, mayor);
      if (!(v > 0)) return { error: `${p.n} no tiene precio: envía el pedido por WhatsApp para cotizarlo.` };
      total += v * x.q;
      lineas.push({ name: p.n.slice(0, 120), code: x.id.slice(0, 60), unit_price: v, quantity: x.q, price: v * x.q });
    }
    return { lineas, total };
  }

  return { MAX, normalizar, miles, clp, precio, esMayor, sanear, cuenta, filtrar, codigoPedido, mensajePedido, lineasCobro };
});
