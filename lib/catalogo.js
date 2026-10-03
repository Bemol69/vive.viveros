// Lee los productos de data/productos/*.json y los deja limpios.
// Lo usan scripts/build.mjs (para armar la web) y api/klap/* (para cobrar con los precios reales,
// nunca con los que manda el navegador). Así los dos ven exactamente el mismo catálogo.
const { readdirSync, readFileSync } = require('node:fs');
const { join, basename } = require('node:path');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const rel = (path) => str(path).replace(/^\//, '');
const num = (v, def) => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : def);
const lista = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const entero = (v) => { const n = Math.round(num(v, 0)); return n > 0 ? n : 0; };

function leerProductos(raiz, { avisar = () => {} } = {}) {
  const dir = join(raiz, 'data', 'productos');
  let archivos = [];
  try { archivos = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const salida = [];
  for (const archivo of archivos) {
    let p;
    try { p = JSON.parse(readFileSync(join(dir, archivo), 'utf8')); } catch (e) {
      // Un archivo dañado no debe botar la web: se omite y se avisa
      avisar(`Se omitió productos/${archivo}: ${e.message}`);
      continue;
    }
    if (!p || typeof p !== 'object' || p.visible === false || !str(p.nombre)) continue;
    const precio = entero(p.precio);
    const mayor = entero(p.precio_mayor);
    salida.push({
      id: basename(archivo, '.json'),
      nombre: str(p.nombre),
      categoria: str(p.categoria) || 'Otros',
      precio,
      precioMayor: mayor && (!precio || mayor < precio) ? mayor : 0,
      descripcion: str(p.descripcion),
      luz: str(p.luz),
      riego: str(p.riego),
      etiqueta: str(p.etiqueta),
      portada: rel(p.portada),
      fotos: lista(p.fotos).map(rel),
      destacado: p.destacado === true,
      inicio: p.inicio === true,
      agotado: p.agotado === true,
      orden: num(p.orden, 1000),
    });
  }
  return salida.sort((a, b) => (b.destacado - a.destacado) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));
}

// Lo mínimo para calcular precios (mismo formato que usa el navegador: nucleo.js)
function mapaPrecios(productos) {
  const m = {};
  for (const p of productos) m[p.id] = { n: p.nombre, v: p.precio, w: p.precioMayor, a: p.agotado };
  return m;
}

module.exports = { leerProductos, mapaPrecios, str, rel, num, lista };
