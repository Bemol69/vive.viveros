// Interacción propia de la portada (el contenido ya viene escrito en el HTML por scripts/build.mjs):
// títulos animados, revelados, contadores, filtros, popup del flyer y mapa diferido.
// La ficha de producto y el pedido están en tienda.js (compartido con el catálogo).
(() => {
  const S = window.SITIO || {};
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // ---------- Flyer (popup una vez por visita) ----------
  const flyer = $('[data-flyer]');
  if (flyer && S.popup) {
    let visto = false;
    try { visto = sessionStorage.getItem('flyer-visto') === '1'; } catch { /* sin almacenamiento */ }
    if (!visto) {
      setTimeout(() => {
        window.Tienda.abrirDialog(flyer);
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
