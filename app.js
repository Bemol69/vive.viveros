// Interacción de la web (el contenido ya viene escrito en el HTML por scripts/build.mjs):
// nav, revelados, contadores, filtros, ficha de planta, formulario a WhatsApp,
// horario abierto/cerrado, popup del flyer y mapa diferido.
(() => {
  const S = window.SITIO || {};
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wa = (texto) => (S.whatsapp ? `https://api.whatsapp.com/send?phone=${S.whatsapp}&text=${encodeURIComponent(texto)}` : S.ig || '#visitanos');

  // ---------- Nav con borde al bajar ----------
  const nav = $('[data-nav]');
  let pend = false;
  addEventListener('scroll', () => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { nav && nav.classList.toggle('is-scroll', scrollY > 8); pend = false; });
  }, { passive: true });

  // ---------- Título por palabras ----------
  const titulo = $('[data-palabras]');
  if (titulo && !quieto) {
    let i = 0;
    const partir = (nodo) => {
      [...nodo.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((t) => {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.append(t); return; }
            const s = document.createElement('span');
            s.className = 'palabra';
            s.style.setProperty('--i', i++);
            s.textContent = t;
            frag.append(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) {
          n.classList.add('palabra');
          n.style.setProperty('--i', i++);
        }
      });
    };
    partir(titulo);
  }

  // ---------- Revelados y contadores ----------
  const contar = (el) => {
    const fin = Number(el.dataset.count) || 0;
    if (quieto || !fin) return;
    const t0 = performance.now(), dur = 1400;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(fin * (1 - Math.pow(1 - k, 3))).toLocaleString('es-CL');
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  };
  const objetivos = [...$$('[data-reveal]'), titulo, $('[data-arco]'), $('.hero__arco'), $('.vivero__fotos')].filter(Boolean);
  if ('IntersectionObserver' in window && !quieto) {
    const io = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        $$('[data-count]', e.target).forEach(contar);
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .12 });
    objetivos.forEach((el) => io.observe(el));
    // Las cifras están en <li data-reveal>: se cuentan al aparecer
  } else {
    objetivos.forEach((el) => el.classList.add('is-in'));
  }
  // La portada se anima al cargar, sin esperar al observador
  requestAnimationFrame(() => [titulo, $('[data-arco]'), $('.hero__arco')].forEach((el) => el && el.classList.add('is-in')));

  // ---------- Filtros ----------
  const grilla = $('[data-grilla]');
  $$('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.filtro;
    $$('[data-filtro]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', x === b); });
    grilla.dataset.filtro = f;
    $$('.planta[data-cat]', grilla).forEach((p) => {
      p.hidden = f !== '*' && p.dataset.cat !== f;
      if (!p.hidden) p.classList.add('is-in');
    });
  }));

  // ---------- Ficha de planta ----------
  const ficha = $('[data-ficha]');
  const abrirDialog = (d) => { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); document.body.style.overflow = 'hidden'; };
  const cerrarDialog = (d) => { if (d.close) d.close(); else d.removeAttribute('open'); };
  $$('dialog').forEach((d) => {
    d.addEventListener('close', () => { document.body.style.overflow = ''; });
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-cerrar]')) cerrarDialog(d); });
  });

  function mostrarFoto(src, nombre, n) {
    const img = $('[data-ficha-foto]', ficha);
    img.src = src;
    img.alt = `${nombre} · foto ${n + 1}`;
    $$('[data-ficha-minis] button', ficha).forEach((b, i) => b.classList.toggle('is-on', i === n));
  }
  function abrirFicha(id) {
    const p = S.productos && S.productos[id];
    if (!p || !ficha) return;
    $('[data-ficha-cat]', ficha).textContent = p.c;
    $('[data-ficha-nombre]', ficha).textContent = p.n;
    $('[data-ficha-precio]', ficha).textContent = p.p || 'Consultar precio';
    $('[data-ficha-desc]', ficha).textContent = p.d;
    const luz = $('[data-ficha-luz]', ficha), riego = $('[data-ficha-riego]', ficha);
    luz.hidden = !p.l; $('dd', luz).textContent = p.l;
    riego.hidden = !p.r; $('dd', riego).textContent = p.r;
    $('[data-ficha-cuidados]', ficha).hidden = !p.l && !p.r;
    const minis = $('[data-ficha-minis]', ficha);
    minis.innerHTML = '';
    if (p.f.length > 1) {
      p.f.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Ver foto ${i + 1}`);
        b.innerHTML = `<img src="${src}" alt="" loading="lazy">`;
        b.addEventListener('click', () => mostrarFoto(src, p.n, i));
        minis.append(b);
      });
    }
    mostrarFoto(p.f[0], p.n, 0);
    const link = $('[data-ficha-wa]', ficha);
    link.href = wa(`Hola Vive Viveros 🌿 Quiero reservar *${p.n}*${p.p ? ` (${p.p})` : ''} 👋`);
    $('[data-ficha-wa-texto]', ficha).textContent = !S.whatsapp ? 'Consultar por Instagram' : p.p ? 'Reservar por WhatsApp' : 'Cotizar por WhatsApp';
    abrirDialog(ficha);
  }
  $$('[data-planta]').forEach((b) => b.addEventListener('click', () => abrirFicha(b.dataset.planta)));

  // ---------- Formulario a WhatsApp ----------
  const form = $('[data-form]');
  if (form) {
    const vista = $('[data-vista]', form), vistaTexto = $('[data-vista-texto]', form);
    const valor = (n) => {
      const el = form.elements[n];
      return el ? String(el.value || '').trim() : '';
    };
    const mensaje = () => {
      const lineas = [`Hola Vive Viveros 🌿`, `Soy *${valor('nombre') || '…'}*.`, ''];
      lineas.push(`🪴 *Busco:* ${valor('planta') || '…'}`);
      lineas.push(`🛒 *Compra:* ${valor('compra')}`);
      lineas.push(`🚗 *Entrega:* ${valor('entrega')}`);
      if (valor('comuna')) lineas.push(`📍 *Comuna:* ${valor('comuna')}`);
      if (valor('detalle')) lineas.push('', `📝 ${valor('detalle')}`);
      lineas.push('', '¡Gracias! 😊');
      return lineas.join('\n');
    };
    const actualizar = () => {
      const algo = valor('nombre') || valor('planta') || valor('detalle');
      vista.hidden = !algo;
      vistaTexto.textContent = mensaje();
    };
    const validar = () => {
      let ok = true;
      ['nombre', 'planta'].forEach((n) => {
        const campo = form.elements[n].closest('.campo');
        const bien = !!valor(n);
        campo.classList.toggle('is-error', !bien);
        if (!bien && ok) { form.elements[n].focus(); ok = false; }
      });
      return ok;
    };
    form.addEventListener('input', (e) => { actualizar(); const c = e.target.closest('.campo'); if (c && e.target.value) c.classList.remove('is-error'); });
    form.addEventListener('change', actualizar);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validar()) return;
      window.open(wa(mensaje()), '_blank', 'noopener');
    });
    // Tocar "Reservar" en una planta deja esa planta elegida en el formulario
    $$('.planta__wa').forEach((a) => a.addEventListener('click', () => {
      const id = a.closest('.planta').querySelector('[data-planta]').dataset.planta;
      const p = S.productos[id];
      if (p) { form.elements.planta.value = p.n; actualizar(); }
    }));
  }

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

  // ---------- Flyer (popup una vez por visita) ----------
  const flyer = $('[data-flyer]');
  if (flyer && S.popup) {
    let visto = false;
    try { visto = sessionStorage.getItem('flyer-visto') === '1'; } catch { /* sin almacenamiento */ }
    if (!visto) {
      setTimeout(() => {
        abrirDialog(flyer);
        try { sessionStorage.setItem('flyer-visto', '1'); } catch { /* sin almacenamiento */ }
      }, 2500);
    }
  }

  // ---------- Mapa diferido (no carga Google hasta acercarse) ----------
  const mapa = $('[data-mapa]');
  if (mapa) {
    const cargar = () => {
      if (mapa.querySelector('iframe')) return;
      const f = document.createElement('iframe');
      f.src = mapa.dataset.src;
      f.title = mapa.dataset.titulo;
      f.loading = 'lazy';
      f.referrerPolicy = 'no-referrer-when-downgrade';
      f.allowFullscreen = true;
      mapa.append(f);
    };
    $('[data-mapa-cargar]', mapa).addEventListener('click', cargar);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { cargar(); io.disconnect(); } }, { rootMargin: '300px' });
      io.observe(mapa);
    }
  }
})();
