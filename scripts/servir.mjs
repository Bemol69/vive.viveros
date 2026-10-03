// Servidor local que se comporta como Vercel: sirve dist/ con URLs limpias (/catalogo → catalogo.html)
// y ejecuta las funciones de api/ (pago con Klap). Uso: npm run build && npm run servir
// Para probar Klap en sandbox: KLAP_APIKEY=... npm run servir  (y pago_online: true en data/ajustes.json)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.VV_DIST || join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 5620;
const require = createRequire(import.meta.url);
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8', '.ico': 'image/x-icon',
};

// Mismas comodidades que Vercel les da a las funciones: req.query, req.body, res.status().json()
function adaptar(req, res, url, cuerpo) {
  req.query = Object.fromEntries(url.searchParams);
  req.body = cuerpo;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
}

async function archivo(ruta) {
  const limpia = normalize(decodeURIComponent(ruta)).replace(/^([\\/])+/, '');
  if (limpia.startsWith('..')) return null;
  for (const c of [limpia, `${limpia}.html`, join(limpia, 'index.html')]) {
    const f = join(DIST, c);
    try { if ((await stat(f)).isFile()) return f; } catch { /* sigue */ }
  }
  return null;
}

export function crearServidor() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      const api = url.pathname.match(/^\/api\/klap\/(crear-orden|estado|webhook)$/);
      if (api) {
        let crudo = '';
        for await (const c of req) { crudo += c; if (crudo.length > 1e6) break; }
        let cuerpo = crudo;
        if (/json/.test(req.headers['content-type'] || '')) { try { cuerpo = JSON.parse(crudo || '{}'); } catch { cuerpo = crudo; } }
        adaptar(req, res, url, cuerpo);
        const fn = require(join(ROOT, 'api', 'klap', `${api[1]}.js`));
        return await fn(req, res);
      }
      const f = await archivo(url.pathname === '/' ? 'index.html' : url.pathname);
      if (!f) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('No encontrado');
      }
      res.setHeader('Content-Type', TIPOS[extname(f).toLowerCase()] || 'application/octet-stream');
      res.end(await readFile(f));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Error del servidor');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  crearServidor().listen(PORT, () => console.log(`🌿 Vive Viveros en http://localhost:${PORT}  (catálogo: /catalogo)`));
}
