// Test catalogue server: zero dependencies (Node 18+ built-ins only).
//
//   node server.mjs            → http://127.0.0.1:5180
//
// Serves the UI from ./public and persists edits to ./data/catalogue.json (the single
// source of truth, also updated by scripts/case.mjs) through lib/store.mjs.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITABLE_FIELDS, normaliseTest, validateCatalogue, validateTest } from './lib/catalogue.mjs';
import { DATA_FILE, mutateCatalogue, readCatalogue } from './lib/store.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const LIB_DIR = resolve(ROOT, 'lib');
const HOST = process.env.TEST_MANAGER_HOST || '127.0.0.1';
const PORT = Number(process.env.TEST_MANAGER_PORT || 5180);
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------- http helpers

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

async function serveStatic(res, baseDir, relPath) {
  const filePath = normalize(join(baseDir, relPath));
  if (filePath !== baseDir && !filePath.startsWith(baseDir + sep)) throw new HttpError(403, 'Forbidden');
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('not a file');
  } catch {
    throw new HttpError(404, 'Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(await readFile(filePath));
}

// ---------------------------------------------------------------- routes

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = decodeURIComponent(url.pathname);

  if (path === '/api/catalogue' && req.method === 'GET') {
    return sendJson(res, 200, await readCatalogue());
  }

  // Replace the whole catalogue (JSON import).
  if (path === '/api/catalogue' && req.method === 'PUT') {
    const doc = await readJsonBody(req);
    const errors = validateCatalogue(doc);
    if (errors.length) throw new HttpError(422, 'Catalogue is invalid', errors);
    const saved = await mutateCatalogue((current) => {
      current.schemaVersion = doc.schemaVersion ?? current.schemaVersion ?? 1;
      current.tests = doc.tests.map(normaliseTest);
      return current;
    });
    return sendJson(res, 200, saved);
  }

  // Update one test case; the id in the URL is authoritative and can never change.
  const match = path.match(/^\/api\/tests\/([^/]+)$/);
  if (match && req.method === 'PATCH') {
    const id = match[1];
    const changes = await readJsonBody(req);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new HttpError(400, 'Body must be a JSON object of fields to change');
    }
    if ('id' in changes && changes.id !== id) throw new HttpError(400, 'Test case IDs are permanent and cannot be changed');
    const unknown = Object.keys(changes).filter((k) => k !== 'id' && k !== 'updatedAt' && !EDITABLE_FIELDS.includes(k));
    if (unknown.length) throw new HttpError(400, `Unknown or read-only fields: ${unknown.join(', ')}`);

    const updated = await mutateCatalogue((doc) => {
      const index = doc.tests.findIndex((t) => t.id === id);
      if (index === -1) throw new HttpError(404, `Test case ${id} was not found`);
      const next = { ...doc.tests[index] };
      for (const f of EDITABLE_FIELDS) if (f in changes) next[f] = changes[f];
      next.updatedAt = new Date().toISOString();
      const errors = validateTest(next);
      if (errors.length) throw new HttpError(422, 'Test case is invalid', errors);
      doc.tests[index] = next;
      return next;
    });
    return sendJson(res, 200, updated);
  }

  if (path.startsWith('/api/')) throw new HttpError(404, 'Unknown API route');
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  if (path.startsWith('/lib/')) return serveStatic(res, LIB_DIR, path.slice('/lib/'.length));
  return serveStatic(res, PUBLIC_DIR, path === '/' ? 'index.html' : path.slice(1));
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.message || 'Internal error', details: err.details ?? null });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Test manager running at http://${HOST}:${PORT}`);
  console.log(`Catalogue file: ${DATA_FILE}`);
});
