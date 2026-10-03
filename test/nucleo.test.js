// Pruebas de la lógica de la tienda (precios, carrito, búsqueda y mensaje de WhatsApp). Correr: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../nucleo.js');

const P = {
  limonero: { n: 'Limonero Eureka', c: 'Frutales', v: 8000, a: 0, o: 2 },
  limon: { n: 'Limón sutil', c: 'Frutales', v: 8000, a: 0, o: 5 },
  dracena: { n: 'Dracena Marginata', c: 'Plantas de interior', v: 10000, w: 7900, a: 0, o: 1 },
  cotiza: { n: 'Olivo centenario', c: 'Árboles', v: 0, a: 0, o: 3 },
  agotado: { n: 'Arce japonés', c: 'Árboles', v: 30000, a: 1, o: 0 },
  macetero: { n: 'Macetero Liso N17', c: 'Maceteros', v: 500, a: 0, o: 4, d: 'Plástico negro' },
};
const lista = Object.entries(P).map(([id, p]) => ({ id, ...p }));

test('normalizar quita tildes, mayúsculas y signos', () => {
  assert.equal(N.normalizar('  LIMÓN Sutil!! '), 'limon sutil');
  assert.equal(N.normalizar('Cuna de Moisés M14'), 'cuna de moises m14');
  assert.equal(N.normalizar(null), '');
  assert.equal(N.normalizar('Jardinera  N° 45'), 'jardinera n 45');
});

test('clp formatea pesos chilenos', () => {
  assert.equal(N.clp(0), '$0');
  assert.equal(N.clp(8000), '$8.000');
  assert.equal(N.clp(1234567), '$1.234.567');
  assert.equal(N.clp('abc'), '$0');
});

test('sanear: descarta productos inexistentes, cantidades inválidas y suma repetidos', () => {
  const r = N.sanear([
    { id: 'limonero', q: 2 }, { id: 'limonero', q: 3 }, { id: 'no-existe', q: 1 },
    { id: 'limon', q: 0 }, { id: 'dracena', q: -4 }, { id: 'macetero', q: 2.9 },
    { id: 'cotiza', q: 'x' }, null, 'basura', { id: '__proto__', q: 1 }, { id: 'toString', q: 1 },
  ], P);
  assert.deepEqual(r, [{ id: 'limonero', q: 5 }, { id: 'macetero', q: 2 }]);
  assert.deepEqual(N.sanear('no es lista', P), []);
  assert.deepEqual(N.sanear(null, P), []);
});

test('sanear: tope de 999 por producto', () => {
  assert.deepEqual(N.sanear([{ id: 'limon', q: 5000 }], P), [{ id: 'limon', q: 999 }]);
  assert.deepEqual(N.sanear([{ id: 'limon', q: 600 }, { id: 'limon', q: 600 }], P), [{ id: 'limon', q: 999 }]);
});

test('cuenta: total, cantidad y productos por cotizar', () => {
  const items = [{ id: 'limonero', q: 2 }, { id: 'cotiza', q: 1 }, { id: 'dracena', q: 1 }];
  assert.deepEqual(N.cuenta(items, P), { n: 4, total: 26000, sinPrecio: 1 });
  assert.deepEqual(N.cuenta([], P), { n: 0, total: 0, sinPrecio: 0 });
});

test('precio por mayor solo se aplica si existe y el cliente compra por mayor', () => {
  const items = [{ id: 'dracena', q: 2 }, { id: 'limon', q: 1 }];
  assert.equal(N.cuenta(items, P, false).total, 28000);
  assert.equal(N.cuenta(items, P, true).total, 7900 * 2 + 8000);
  assert.equal(N.esMayor('Por mayor (tengo negocio)'), true);
  assert.equal(N.esMayor('Para mí (al detalle)'), false);
  assert.equal(N.esMayor(undefined), false);
});

test('filtrar: busca sin tildes, por varias palabras y en la descripción', () => {
  assert.deepEqual(N.filtrar(lista, { q: 'LIMON' }).map((p) => p.id).sort(), ['limon', 'limonero']);
  assert.deepEqual(N.filtrar(lista, { q: 'sutil limón' }).map((p) => p.id), ['limon']);
  assert.deepEqual(N.filtrar(lista, { q: 'plastico' }).map((p) => p.id), ['macetero']);
  assert.deepEqual(N.filtrar(lista, { q: 'zzz' }), []);
});

test('filtrar: categoría, disponibles y orden', () => {
  assert.deepEqual(N.filtrar(lista, { cat: 'Árboles' }).map((p) => p.id), ['cotiza', 'agotado']);
  assert.deepEqual(N.filtrar(lista, { cat: 'Árboles', disponibles: true }).map((p) => p.id), ['cotiza']);
  // Precio: los sin precio van al final al ordenar de menor a mayor
  const asc = N.filtrar(lista, { orden: 'precio-asc' }).map((p) => p.id);
  assert.equal(asc[0], 'macetero');
  assert.equal(asc[asc.length - 1], 'cotiza');
  assert.equal(N.filtrar(lista, { orden: 'precio-desc' })[0].id, 'agotado');
  assert.deepEqual(N.filtrar(lista, { orden: 'a-z' }).map((p) => p.n)[0], 'Arce japonés');
  // Relevancia: los agotados al final aunque tengan mejor orden
  const rel = N.filtrar(lista, {}).map((p) => p.id);
  assert.equal(rel[rel.length - 1], 'agotado');
  assert.equal(rel[0], 'dracena');
  // No modifica la lista original
  assert.equal(lista[0].id, 'limonero');
});

test('codigoPedido: formato VV-XXXX', () => {
  for (let i = 0; i < 200; i++) assert.match(N.codigoPedido(Date.now() + i * 997, Math.random()), /^VV-[0-9A-Z]{4}$/);
  assert.match(N.codigoPedido(0, 0), /^VV-[0-9A-Z]{4}$/);
});

test('mensajePedido: retiro, despacho, encargo y por mayor', () => {
  const items = [{ id: 'limonero', q: 2 }, { id: 'cotiza', q: 1 }];
  const retiro = N.mensajePedido({ codigo: 'VV-AB12', items, productos: P, datos: { nombre: 'Camila', entrega: 'retiro', pago: 'Transferencia' } });
  assert.match(retiro, /\*PEDIDO VIVE VIVEROS · VV-AB12\*/);
  assert.match(retiro, /\*2 × Limonero Eureka\* — \$16\.000/);
  assert.match(retiro, /\*1 × Olivo centenario\* — precio a confirmar/);
  assert.match(retiro, /\*Total:\* \$16\.000 \+ plantas por cotizar/);
  assert.match(retiro, /Retiro en el vivero/);
  assert.match(retiro, /\*Pago:\* Transferencia/);
  assert.doesNotMatch(retiro, /Dirección/);

  const despacho = N.mensajePedido({ codigo: 'VV-AB12', items, productos: P, datos: { entrega: 'despacho', comuna: 'Rengo', encargo: '20 lavandas' } });
  assert.match(despacho, /\+ despacho/);
  assert.match(despacho, /\*Comuna:\* Rengo/);
  assert.match(despacho, /\*Dirección:\* _\(por completar\)_/);
  assert.match(despacho, /\*Nombre:\* _\(por completar\)_/);
  assert.match(despacho, /También busco:\* 20 lavandas/);

  const mayor = N.mensajePedido({ codigo: 'VV-AB12', items: [{ id: 'dracena', q: 3 }], productos: P, datos: { compra: 'Por mayor (tengo negocio)' } });
  assert.match(mayor, /\$23\.700 \(precio por mayor\)/);

  const solo = N.mensajePedido({ codigo: 'VV-AB12', items: [], productos: P, datos: { encargo: 'un olivo' } });
  assert.doesNotMatch(solo, /Total/);

  const pagado = N.mensajePedido({ codigo: 'VV-AB12', items, productos: P, datos: { pago: 'Efectivo' }, pagado: 'orden Klap 123' });
  assert.match(pagado, /Pagado con tarjeta\* \(orden Klap 123\)/);
  assert.doesNotMatch(pagado, /\*Pago:\*/);
});

test('lineasCobro: solo cobra productos con precio, disponibles y existentes', () => {
  const ok = N.lineasCobro([{ id: 'limonero', q: 2 }, { id: 'macetero', q: 3 }], P);
  assert.equal(ok.total, 17500);
  assert.deepEqual(ok.lineas[0], { name: 'Limonero Eureka', code: 'limonero', unit_price: 8000, quantity: 2, price: 16000 });
  assert.match(N.lineasCobro([], P).error, /vacío/);
  assert.match(N.lineasCobro([{ id: 'cotiza', q: 1 }], P).error, /no tiene precio/);
  assert.match(N.lineasCobro([{ id: 'agotado', q: 1 }], P).error, /agotado/);
  assert.match(N.lineasCobro([{ id: 'fantasma', q: 1 }], P).error, /ya no está/);
  assert.equal(N.lineasCobro([{ id: 'dracena', q: 2 }], P, true).total, 15800);
});
