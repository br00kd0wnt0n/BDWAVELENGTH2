// Minimal zero-dependency static server. Serves the project root over HTTP
// on process.env.PORT (Railway injects this) or 8000 locally.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.webm': 'video/webm',
  '.map':  'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname === '/') pathname = '/index.html';

  // Block path traversal
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'not found');
    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`[wavelength] serving ${ROOT} on :${PORT}`);
});
