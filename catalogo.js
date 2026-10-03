// Catálogo: búsqueda instantánea (sin tildes ni mayúsculas), categorías con contador, orden,
// «solo disponibles», carga por tandas y links que se pueden compartir (?q=…&cat=…&orden=… y ?p=producto).
// Las tarjetas ya vienen en el HTML (las escribe el build para Google); aquí solo se filtran y ordenan.
(() => {
  const S = window.SITIO || {};
  const N = window.Nucleo;
  const T = window.Tienda;
  const { $, $$ } = T;
  const TANDA = 48;

  const grilla = $('[data-cat-grilla]');
  if (!grilla) return;
  const tarjetas = new Map($$('.prod', grilla).map((el) => [el.dataset.id, el]));
  const lista = Object.entries(S.productos || {}).filter(([id]) => tarjetas.has(id)).map(([id, p]) => ({ id, ...p }));

  const buscar = $('[data-buscar]');
  const borrar = $('[data-buscar-borrar]');
  const orden = $('[data-orden]');
  const disponibles = $('[data-disponibles]');
  const chips = $$('[data-chip]');
  const resultado = $('[data-resultado]');
  const mas = $('[data-cat-mas]');
  const vacio = $('[data-cat-vacio]');
  const barra = $('[data-cat-barra]');
  const ficha = $('[data-ficha]');

  // Estado inicial desde la URL (links compartidos)
  const url = new URLSearchParams(location.search);
  const estado = {
    q: (url.get('q') || '').slice(0, 80),
    cat: S.categorias && S.categorias.includes(url.get('cat')) ? url.get('cat') : '',
    orden: ['relevancia', 'a-z', 'z-a', 'precio-asc', 'precio-desc'].includes(url.get('orden')) ? url.get('orden') : 'relevancia',
    disponibles: url.get('disp') === '1',
    mostrar: TANDA,
  };
  buscar.value = estado.q;
  orden.value = estado.orden;
  disponibles.checked = estado.disponibles;

  let filtrados = [];

  function guardarUrl() {
    const u = new URLSearchParams();
    if (estado.q) u.set('q', estado.q);
    if (estado.cat) u.set('cat', estado.cat);
    if (estado.orden !== 'relevancia') u.set('orden', estado.orden);
    if (estado.disponibles) u.set('disp', '1');
    // Mientras la ficha abierta por un link (?p=) siga abierta, el link se mantiene
    const p = new URLSearchParams(location.search).get('p');
    if (p && ficha && ficha.open) u.set('p', p);
    const nueva = `${location.pathname}${u.toString() ? `?${u}` : ''}`;
    if (nueva !== `${location.pathname}${location.search}`) history.replaceState(null, '', nueva);
  }

  // Cantidades de las tarjetas (las que estaban fuera de la página no se actualizaron solas)
  function pintarControles(els) {
    els.forEach((el) => {
      const c = $('[data-ctrl]', el);
      if (!c) return;
      const q = T.cantidad ? T.cantidad(el.dataset.id) : 0;
      c.classList.toggle('is-en', q > 0);
      $('[data-ctrl-q]', c).textContent = q;
    });
  }

  function aplicar({ reiniciar = true } = {}) {
    if (reiniciar) estado.mostrar = TANDA;
    // Contadores de categorías según la búsqueda actual
    const base = N.filtrar(lista, { q: estado.q, disponibles: estado.disponibles });
    const porCat = {};
    base.forEach((p) => { porCat[p.c] = (porCat[p.c] || 0) + 1; });
    chips.forEach((b) => {
      const c = b.dataset.chip;
      const n = c ? porCat[c] || 0 : base.length;
      $('span', b).textContent = n;
      b.classList.toggle('is-on', c === estado.cat);
      b.setAttribute('aria-pressed', c === estado.cat);
      b.classList.toggle('is-cero', !n && c !== estado.cat);
    });

    filtrados = N.filtrar(lista, estado);
    const visibles = filtrados.slice(0, estado.mostrar).map((p) => tarjetas.get(p.id));
    grilla.replaceChildren(...visibles);
    pintarControles(visibles);

    const total = filtrados.length;
    const donde = estado.cat ? ` en ${estado.cat}` : '';
    resultado.textContent = !total ? 'Sin resultados'
      : estado.q ? `${total} ${total === 1 ? 'resultado' : 'resultados'} para «${estado.q}»${donde}`
        : `${total} ${total === 1 ? 'producto' : 'productos'}${donde}`;
    mas.hidden = total <= estado.mostrar;
    if (!mas.hidden) $('[data-ver-mas]', mas).textContent = `Ver más productos (${total - estado.mostrar})`;
    vacio.hidden = total > 0;
    if (!total) $('[data-vacio-q]', vacio).textContent = estado.q || estado.cat || 'eso';
    borrar.hidden = !estado.q;
    guardarUrl();
  }

  // Búsqueda mientras se escribe
  let tBuscar;
  buscar.addEventListener('input', () => {
    clearTimeout(tBuscar);
    tBuscar = setTimeout(() => { estado.q = buscar.value.trim().slice(0, 80); aplicar(); }, 120);
  });
  $('[data-buscador]').addEventListener('submit', (e) => { e.preventDefault(); buscar.blur(); });
  borrar.addEventListener('click', () => { buscar.value = ''; estado.q = ''; aplicar(); buscar.focus(); });
  // «/» enfoca el buscador (como en las tiendas grandes)
  addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !$('dialog[open]')) { e.preventDefault(); buscar.focus(); }
  });

  chips.forEach((b) => b.addEventListener('click', () => {
    estado.cat = b.dataset.chip === estado.cat ? '' : b.dataset.chip;
    aplicar();
    b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    // Si la barra quedó pegada arriba, vuelve al inicio de la grilla
    if (barra.getBoundingClientRect().top <= 1) grilla.scrollIntoView({ block: 'start' });
  }));
  orden.addEventListener('change', () => { estado.orden = orden.value; aplicar(); });
  disponibles.addEventListener('change', () => { estado.disponibles = disponibles.checked; aplicar(); });

  // Más productos: botón y carga automática al acercarse al final
  function verMas() { estado.mostrar += TANDA; aplicar({ reiniciar: false }); }
  $('[data-ver-mas]', mas).addEventListener('click', verMas);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((e) => { if (e[0].isIntersecting && !mas.hidden) verMas(); }, { rootMargin: '600px' }).observe(mas);
  }

  // Nada encontrado: lo pide por WhatsApp desde el pedido
  const encargar = $('[data-encargar]');
  if (encargar) encargar.addEventListener('click', () => T.abrirPedido && T.abrirPedido({ encargo: estado.q || estado.cat }));
  $('[data-limpiar]').addEventListener('click', () => {
    Object.assign(estado, { q: '', cat: '', disponibles: false });
    buscar.value = ''; disponibles.checked = false;
    aplicar();
  });

  // Sombra de la barra cuando queda pegada arriba
  if ('IntersectionObserver' in window) {
    const centinela = document.createElement('div');
    centinela.className = 'cat-centinela';
    barra.before(centinela);
    new IntersectionObserver(([e]) => barra.classList.toggle('is-pegada', !e.isIntersecting), { rootMargin: '-72px 0px 0px' }).observe(centinela);
  }

  // Cuando cambia el pedido, se actualizan las tarjetas visibles
  if (T.alCambiar) T.alCambiar(() => pintarControles([...grilla.children]));

  // ?p=producto abre su ficha (links para compartir por WhatsApp o Instagram)
  const pid = url.get('p');
  if (pid && S.productos[pid]) T.abrirFicha(pid);
  if (ficha) ficha.addEventListener('close', guardarUrl);
  aplicar();
})();
