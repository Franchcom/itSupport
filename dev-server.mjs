// Lokaler Server fuer Entwicklung und Tests: liefert die Web-Dateien aus und leitet
// /api/* an dieselben Handler wie auf Vercel. Speichert in .data/dev-store.json.
//
//   npm run dev            -> http://localhost:3000
//   PORT=4000 npm run dev

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
process.env.KZ_FILE_STORE ||= join(root, '.data', 'dev-store.json');
process.env.KZ_SETUP_TOKEN ||= 'dev-setup-token-0000';
await mkdir(join(root, '.data'), { recursive: true });

const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const globalHeaders = vercel.headers.find((h) => h.source === '/(.*)').headers;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  for (const { key, value } of globalHeaders) if (key !== 'Strict-Transport-Security') res.setHeader(key, value);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '');
    if (!/^[a-z]+$/.test(name)) {
      res.statusCode = 404;
      return res.end();
    }
    try {
      const mod = await import(join(root, 'api', `${name}.js`));
      return mod.default(req, res);
    } catch (e) {
      if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(e);
      res.statusCode = 404;
      return res.end();
    }
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  // Nur die Web-Dateien ausliefern, wie auf Vercel (siehe .vercelignore).
  if (!/^\/(index\.html|app\.css|sw\.js|manifest\.webmanifest|js\/[\w.-]+\.js|icons\/[\w.-]+)$/.test(path)) {
    res.statusCode = 404;
    return res.end('Nicht gefunden');
  }
  try {
    const body = await readFile(join(root, path));
    res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Nicht gefunden');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`itSupport laeuft auf http://localhost:${port}`);
  console.log(`Einrichtungs-Code (nur lokal): ${process.env.KZ_SETUP_TOKEN}`);
});
