// Partes compartidas por la portada y el catálogo: ventanas (dialog), ficha de producto,
// el pedido (carrito + datos de entrega → WhatsApp) y el pago con tarjeta (Klap, si está activo).
// La lógica de precios y mensajes vive en nucleo.js (probada con `npm test`).
(() => {
  const S = window.SITIO || {};
  const N = window.Nucleo;
  const P = S.productos || {};
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const wa = (texto) => (S.whatsapp ? `https://api.whatsapp.com/send?phone=${S.whatsapp}&text=${encodeURIComponent(texto)}` : S.ig || '#visitanos');
  const leer = (clave, def) => { try { const v = JSON.parse(localStorage.getItem(clave)); return v == null ? def : v; } catch { return def; } };
  const escribir = (clave, v) => { try { localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

  // ---------- Nav con borde al bajar ----------
  const nav = $('[data-nav]');
  let pend = false;
  addEventListener('scroll', () => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { nav && nav.classList.toggle('is-scroll', scrollY > 8); pend = false; });
  }, { passive: true });

  // ---------- Horario abierto / cerrado (hora de Chile) ----------
  const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const horario = Array.isArray(S.horario) ? S.horario : [];
  const aMin = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const hhmm = (h) => h.replace(/^0(\d)/, '$1');
  function ahoraChile() {
    // Para probar: ?ahora=6-12:30 (día 0 = lunes … 6 = domingo)
    const prueba = /[?&]ahora=(\d)-(\d{1,2}):(\d{2})/.exec(location.search);
    if (prueba) return { dia: Number(prueba[1]), min: Number(prueba[2]) * 60 + Number(prueba[3]) };
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santiago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(partes.weekday);
    return { dia, min: Number(partes.hour) % 24 * 60 + Number(partes.minute) };
  }
  function estado() {
    const { dia, min } = ahoraChile();
    const hoy = horario[dia] || [];
    for (const [a, c] of hoy) {
      if (min >= aMin(a) && min < aMin(c)) return { abierto: true, texto: `Abierto ahora · cierra a las ${hhmm(c)}`, dia };
    }
    const siguiente = hoy.find(([a]) => aMin(a) > min);
    if (siguiente) return { abierto: false, texto: `Cerrado · abre hoy a las ${hhmm(siguiente[0])}`, dia };
    for (let k = 1; k <= 7; k++) {
      const d = (dia + k) % 7;
      if (horario[d] && horario[d].length) {
        const cuando = k === 1 ? 'mañana' : `el ${DIAS[d]}`;
        return { abierto: false, texto: `Cerrado · abre ${cuando} a las ${hhmm(horario[d][0][0])}`, dia };
      }
    }
    return null;
  }
  function pintarEstado() {
    const e = estado();
    if (!e) return;
    $$('[data-estado]').forEach((el) => {
      el.classList.toggle('is-abierto', e.abierto);
      el.classList.toggle('is-cerrado', !e.abierto);
      $('[data-estado-texto]', el).textContent = e.texto;
    });
    $$('[data-horario] li').forEach((li) => li.classList.toggle('is-hoy', Number(li.dataset.dia) === e.dia));
  }
  if ($('[data-estado]')) { pintarEstado(); setInterval(pintarEstado, 60000); }

  // ---------- Ventanas ----------
  const desbloquear = () => { if (!$('dialog[open]')) document.body.style.overflow = ''; };
  const abrirDialog = (d) => {
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    document.body.style.overflow = 'hidden';
  };
  // El fondo vuelve a moverse solo cuando no queda ninguna ventana abierta (ej: de la ficha se pasa al pedido)
  const cerrarDialog = (d) => { if (d.close) d.close(); else d.removeAttribute('open'); desbloquear(); };
  $$('dialog').forEach((d) => {
    d.addEventListener('close', desbloquear);
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-cerrar]')) cerrarDialog(d); });
  });

  // ---------- Ficha de producto ----------
  const ficha = $('[data-ficha]');
  // La foto anterior se quita al tiro (sin quedar unos milisegundos en pantalla) y la nueva entra con un fundido
  function mostrarFoto(src, nombre, n) {
    const img = $('[data-ficha-foto]', ficha);
    if (img.getAttribute('src') !== src) {
      img.classList.add('is-cargando');
      img.removeAttribute('src');
      img.onload = img.onerror = () => img.classList.remove('is-cargando');
      img.src = src;
      if (img.complete && img.naturalWidth) img.classList.remove('is-cargando');
    }
    img.alt = `${nombre} · foto ${n + 1}`;
    $$('[data-ficha-minis] button', ficha).forEach((b, i) => b.classList.toggle('is-on', i === n));
  }
  function abrirFicha(id) {
    const p = P[id];
    if (!p || !ficha) return;
    $('[data-ficha-cat]', ficha).textContent = p.c;
    $('[data-ficha-nombre]', ficha).textContent = p.n;
    $('[data-ficha-precio]', ficha).textContent = p.v > 0 ? N.clp(p.v) : 'Consultar precio';
    const desc = $('[data-ficha-desc]', ficha);
    desc.textContent = p.d || '';
    desc.hidden = !p.d;
    const estado = $('[data-ficha-estado]', ficha);
    if (estado) estado.hidden = !p.a;
    const luz = $('[data-ficha-luz]', ficha), riego = $('[data-ficha-riego]', ficha);
    luz.hidden = !p.l; $('dd', luz).textContent = p.l || '';
    riego.hidden = !p.r; $('dd', riego).textContent = p.r || '';
    $('[data-ficha-cuidados]', ficha).hidden = !p.l && !p.r;
    const minis = $('[data-ficha-minis]', ficha);
    minis.innerHTML = '';
    if (p.f.length > 1) {
      p.f.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Ver foto ${i + 1}`);
        const img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        b.append(img);
        b.addEventListener('click', () => mostrarFoto(src, p.n, i));
        minis.append(b);
      });
    }
    mostrarFoto(p.f[0], p.n, 0);
    $('[data-ficha-wa]', ficha).href = wa(`Hola Vive Viveros 🌿 Quiero consultar por *${p.n}*${p.v > 0 ? ` (${N.clp(p.v)})` : ''} 👋`);
    $('[data-ficha-wa-texto]', ficha).textContent = S.whatsapp ? 'Preguntar por WhatsApp' : 'Consultar por Instagram';
    const compartir = $('[data-ficha-compartir]', ficha);
    if (compartir) { compartir.dataset.id = id; $('span', compartir).textContent = 'Compartir'; }
    const agregarBtn = $('[data-ficha-agregar]', ficha);
    if (agregarBtn) {
      agregarBtn.dataset.id = id;
      agregarBtn.disabled = !!p.a;
      $('span', agregarBtn).textContent = p.a ? 'Agotado por ahora' : 'Agregar al pedido';
    }
    abrirDialog(ficha);
  }

  // Precarga la foto grande al acercar el mouse o tocar la tarjeta: la ficha abre con la foto lista
  const precargadas = new Set();
  const precargar = (id) => {
    const p = P[id];
    if (!p || precargadas.has(id)) return;
    precargadas.add(id);
    const img = new Image();
    img.decoding = 'async';
    img.src = p.f[0];
  };
  // Compartir un producto: link directo a su ficha en el catálogo
  const compartirBtn = ficha && $('[data-ficha-compartir]', ficha);
  if (compartirBtn) compartirBtn.addEventListener('click', async () => {
    const p = P[compartirBtn.dataset.id];
    if (!p) return;
    const link = new URL(`catalogo?p=${encodeURIComponent(compartirBtn.dataset.id)}`, location.href).href;
    const texto = $('span', compartirBtn);
    try {
      if (navigator.share) { await navigator.share({ title: p.n, text: `${p.n}${p.v > 0 ? ` · ${N.clp(p.v)}` : ''}`, url: link }); return; }
      await navigator.clipboard.writeText(link);
      texto.textContent = 'Link copiado';
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      texto.textContent = 'No se pudo copiar';
    }
    setTimeout(() => { texto.textContent = 'Compartir'; }, 2200);
  });

  ['pointerover', 'touchstart', 'focusin'].forEach((ev) => document.addEventListener(ev, (e) => {
    const b = e.target.closest && e.target.closest('[data-planta]');
    if (b) precargar(b.dataset.planta);
  }, { passive: true }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-planta]');
    if (b) { e.preventDefault(); abrirFicha(b.dataset.planta); }
  });

  const Tienda = { $, $$, wa, abrirDialog, cerrarDialog, abrirFicha, productos: P, alCambiar: () => {} };
  window.Tienda = Tienda;

  // ---------- Pedido ----------
  const pedido = $('[data-pedido]');
  if (!pedido || !S.whatsapp) return;
  const form = $('[data-checkout]', pedido);
  const lista = $('[data-pedido-lista]', pedido);
  const CLAVE = 'vv-pedido';
  let items = N.sanear(leer(CLAVE, []), P);
  let codigo = N.codigoPedido();
  const oyentes = [];
  const guardar = () => escribir(CLAVE, items);

  const valor = (n) => { const el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
  const datos = () => ({
    nombre: valor('nombre'), compra: valor('compra'), entrega: valor('entrega'), comuna: valor('comuna'),
    direccion: valor('direccion'), pago: valor('pago'), nota: valor('nota'), encargo: valor('encargo'),
  });
  const despacho = () => valor('entrega') === 'despacho';
  const mensaje = (pagado) => N.mensajePedido({ codigo, items, productos: P, datos: datos(), pagado });
  const cantidad = (id) => { const it = items.find((x) => x.id === id); return it ? it.q : 0; };
  const mayor = () => N.esMayor(valor('compra'));
  const pv = (p) => N.precio(p, mayor());

  function filaHtml(x) {
    const p = P[x.id];
    const li = document.createElement('li');
    li.className = 'linea';
    li.dataset.id = x.id;
    li.innerHTML = `
      <img class="linea__foto" alt="" loading="lazy">
      <div class="linea__info">
        <strong class="linea__nombre"></strong>
        <span class="linea__unit">${pv(p) > 0 ? `${N.clp(pv(p))} c/u${mayor() && p.w > 0 ? ' · por mayor' : ''}` : 'Precio a confirmar'}</span>
        <div class="cantidad" role="group" aria-label="Cantidad">
          <button type="button" data-menos aria-label="Quitar una">−</button>
          <input type="number" inputmode="numeric" min="1" max="${N.MAX}" value="${x.q}" aria-label="Cantidad" data-cant>
          <button type="button" data-mas aria-label="Agregar una">+</button>
        </div>
      </div>
      <div class="linea__der">
        <strong class="linea__sub">${pv(p) > 0 ? N.clp(pv(p) * x.q) : '—'}</strong>
        <button type="button" class="linea__quitar" data-quitar aria-label="Quitar del pedido"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-basura"/></svg></button>
      </div>`;
    $('.linea__foto', li).src = p.m;
    $('.linea__nombre', li).textContent = p.n;
    return li;
  }

  function pintar() {
    lista.innerHTML = '';
    items.forEach((x) => lista.append(filaHtml(x)));
    resumen();
  }
  // Todo lo que depende del pedido, menos la lista (así no se pierde el foco al cambiar cantidades)
  function resumen() {
    const { n, total, sinPrecio } = N.cuenta(items, P, mayor());
    $('[data-pedido-vacio]', pedido).hidden = items.length > 0;
    $('[data-pedido-sub]', pedido).textContent = n
      ? `${n} ${n === 1 ? 'producto' : 'productos'} · ${S.pagoOnline ? 'paga con tarjeta o al retirar' : 'reserva sin pago en la web'}`
      : 'Aún no agregas productos';
    const ayuda = $('[data-pedido-ayuda]', pedido);
    if (ayuda) ayuda.textContent = S.pagoOnline ? 'Paga ahora con tarjeta o envía el pedido por WhatsApp y paga al retirar.' : 'Te confirmamos stock y total por WhatsApp antes de pagar.';
    $$('[data-pedido-total]').forEach((el) => { el.textContent = n ? N.clp(total) : el.closest('.bolsa-flota') ? '$0' : '—'; });
    $('[data-pedido-total-label]', pedido).textContent = sinPrecio || despacho() ? `Total${sinPrecio ? ' + por cotizar' : ''}${despacho() ? ' + despacho' : ''}` : 'Total';
    $$('[data-pedido-n]').forEach((el) => { el.textContent = n; if (el.classList.contains('nav__bolsa-n')) el.hidden = !n; });
    $$('.nav__bolsa').forEach((b) => b.setAttribute('aria-label', `Abrir mi pedido (${n} ${n === 1 ? 'producto' : 'productos'})`));
    $$('[data-flota]').forEach((b) => { b.hidden = !n; });
    $$('[data-pedido-cta]').forEach((el) => { el.textContent = n ? `Ver mi pedido (${n})` : 'Ver mi pedido'; });
    $$('.planta__agregar[data-agregar]').forEach((b) => {
      const q = cantidad(b.dataset.agregar);
      b.classList.toggle('is-en', q > 0);
      $('span', b).textContent = q ? `En tu pedido (${q})` : 'Agregar al pedido';
    });
    $$('[data-ctrl]').forEach(pintarControl);
    const pagar = $('[data-pagar]', pedido);
    if (pagar) {
      const cobro = N.lineasCobro(items, P, mayor());
      pagar.hidden = !S.pagoOnline;
      pagar.disabled = !!cobro.error;
      pagar.title = cobro.error || '';
    }
    vista();
    oyentes.forEach((fn) => fn());
  }
  // Control de cantidad de las tarjetas del catálogo: «Agregar» o − n +
  function pintarControl(el) {
    const q = cantidad(el.dataset.ctrl);
    el.classList.toggle('is-en', q > 0);
    const n = $('[data-ctrl-q]', el);
    if (n) n.textContent = q;
  }
  const vista = () => { $('[data-pedido-vista]', pedido).textContent = mensaje(); };

  // Cambia la cantidad de un producto; con 0 se quita
  function cambiar(id, q) {
    const it = items.find((x) => x.id === id);
    if (!it && q > 0 && P[id]) { items.push({ id, q: Math.min(N.MAX, q) }); guardar(); pintar(); return; }
    if (!it) return;
    const li = [...lista.children].find((x) => x.dataset.id === id);
    if (q <= 0) {
      items = items.filter((x) => x !== it);
      if (li) li.remove();
    } else {
      it.q = Math.min(N.MAX, q);
      if (li) {
        $('[data-cant]', li).value = it.q;
        $('.linea__sub', li).textContent = pv(P[id]) > 0 ? N.clp(pv(P[id]) * it.q) : '—';
      }
    }
    guardar();
    resumen();
  }

  lista.addEventListener('click', (e) => {
    const li = e.target.closest('.linea');
    if (!li) return;
    const q = cantidad(li.dataset.id);
    if (e.target.closest('[data-mas]')) cambiar(li.dataset.id, q + 1);
    else if (e.target.closest('[data-menos]')) cambiar(li.dataset.id, q - 1);
    else if (e.target.closest('[data-quitar]')) cambiar(li.dataset.id, 0);
  });
  lista.addEventListener('change', (e) => {
    const input = e.target.closest('[data-cant]');
    if (!input) return;
    const q = Math.floor(Number(input.value));
    cambiar(input.closest('.linea').dataset.id, Number.isFinite(q) && q > 0 ? q : 1);
  });

  // Aviso corto al agregar
  const aviso = $('[data-aviso]');
  let avisoT;
  function avisar(texto) {
    if (!aviso) return;
    $('[data-aviso-texto]', aviso).textContent = texto;
    aviso.hidden = false;
    requestAnimationFrame(() => aviso.classList.add('is-on'));
    clearTimeout(avisoT);
    avisoT = setTimeout(() => { aviso.classList.remove('is-on'); setTimeout(() => { aviso.hidden = true; }, 300); }, 3200);
  }

  function agregar(id, { silencioso = false } = {}) {
    const p = P[id];
    if (!p || p.a) return;
    cambiar(id, cantidad(id) + 1);
    if (!silencioso) avisar(`Agregaste ${p.n} a tu pedido`);
  }
  document.addEventListener('click', (e) => {
    const sumar = e.target.closest('[data-agregar], [data-sumar]');
    const restar = e.target.closest('[data-restar]');
    if (sumar) agregar(sumar.dataset.agregar || sumar.dataset.sumar, { silencioso: !!sumar.dataset.sumar });
    else if (restar) cambiar(restar.dataset.restar, cantidad(restar.dataset.restar) - 1);
  });
  const fichaAgregar = $('[data-ficha-agregar]');
  if (fichaAgregar) fichaAgregar.addEventListener('click', () => { agregar(fichaAgregar.dataset.id); cerrarDialog(ficha); abrirPedido(); });

  function abrirPedido({ encargo } = {}) {
    $('[data-pedido-listo]', pedido).hidden = true;
    form.hidden = false;
    $('[data-pedido-pie]', pedido).hidden = false;
    clearTimeout(avisoT);
    if (aviso) { aviso.classList.remove('is-on'); aviso.hidden = true; }
    if (encargo) {
      form.elements.encargo.value = encargo;
      $('[data-encargo]', form).open = true;
    }
    pintar();
    abrirDialog(pedido);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-abrir-pedido]')) abrirPedido(); });
  // Links a #pedido (por ejemplo desde Instagram) abren el panel
  if (location.hash === '#pedido') abrirPedido();

  // Mostrar campos según la entrega elegida
  const entrega = () => { $$('[data-solo]', form).forEach((el) => { el.hidden = el.dataset.solo !== valor('entrega'); }); };
  form.addEventListener('input', (e) => {
    const c = e.target.closest('.campo');
    if (c && e.target.value) c.classList.remove('is-error');
    $('[data-pedido-error]', pedido).hidden = true;
    vista();
  });
  form.addEventListener('change', (e) => { entrega(); if (e.target.name === 'compra') pintar(); else resumen(); });

  function error(texto, foco) {
    const err = $('[data-pedido-error]', pedido);
    err.textContent = texto;
    err.hidden = false;
    if (foco) foco.focus();
    return false;
  }
  function validar({ conEncargo = true } = {}) {
    const requeridos = ['nombre', ...(despacho() ? ['comuna', 'direccion'] : [])];
    let primero = null;
    requeridos.forEach((n) => {
      const bien = !!valor(n);
      form.elements[n].closest('.campo').classList.toggle('is-error', !bien);
      if (!bien && !primero) primero = form.elements[n];
    });
    if (!items.length && !(conEncargo && valor('encargo'))) {
      const enc = $('[data-encargo]', form);
      enc.open = true;
      return error('Agrega al menos un producto o escribe cuál buscas.', $('textarea', enc));
    }
    if (primero) return error('Completa los datos marcados para enviar tu pedido.', primero);
    $('[data-pedido-error]', pedido).hidden = true;
    return true;
  }

  function mostrarListo(link, textoCodigo) {
    const listo = $('[data-pedido-listo]', pedido);
    $('[data-pedido-codigo]', listo).textContent = textoCodigo;
    $('[data-pedido-reabrir]', listo).href = link;
    form.hidden = true;
    $('[data-pedido-vacio]', pedido).hidden = true;
    $('[data-pedido-pie]', pedido).hidden = true;
    listo.hidden = false;
    $('.pedido__cuerpo', pedido).scrollTop = 0;
  }
  function vaciar() {
    items = [];
    guardar();
    form.elements.encargo.value = '';
    form.elements.nota.value = '';
    codigo = N.codigoPedido();
    pintar();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validar()) return;
    const link = wa(mensaje());
    const enviado = codigo;
    window.open(link, '_blank', 'noopener');
    // Pantalla de listo: el pedido queda en WhatsApp y la bolsa se vacía
    vaciar();
    mostrarListo(link, enviado);
  });

  // ---------- Pago con tarjeta (Klap) ----------
  // Se activa en /admin («Pago con tarjeta») y necesita la API key de Klap en Vercel (ver api/klap/).
  const pagar = $('[data-pagar]', pedido);
  if (pagar && S.pagoOnline) {
    pagar.addEventListener('click', async () => {
      if (!validar({ conEncargo: false })) return;
      const cobro = N.lineasCobro(items, P, mayor());
      if (cobro.error) return error(cobro.error);
      pagar.disabled = true;
      pagar.classList.add('is-cargando');
      try {
        const r = await fetch('/api/klap/crear-orden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo, items, datos: datos() }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.redirect_url) throw new Error(j.error || 'No pudimos iniciar el pago. Intenta de nuevo o envía el pedido por WhatsApp.');
        // pago.html lee esto al volver de Klap: confirma el pago y ofrece avisar por WhatsApp
        escribir('vv-pago', {
          codigo, order_id: j.order_id, creado: Date.now(),
          mensaje: N.mensajePedido({ codigo, items, productos: P, datos: datos(), pagado: `orden Klap ${j.order_id}` }),
        });
        location.href = j.redirect_url;
      } catch (err) {
        error(err.message);
        pagar.disabled = false;
      } finally {
        pagar.classList.remove('is-cargando');
      }
    });
  }

  // Otra pestaña cambió el pedido
  addEventListener('storage', (e) => {
    if (e.key !== CLAVE) return;
    let nuevo = [];
    try { nuevo = JSON.parse(e.newValue); } catch { nuevo = []; }
    items = N.sanear(nuevo, P);
    pintar();
  });

  Object.assign(Tienda, {
    abrirPedido, agregar, cantidad, cambiar, vaciar,
    alCambiar: (fn) => oyentes.push(fn),
    items: () => items.slice(),
  });
  entrega();
  pintar();
})();
