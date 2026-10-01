import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { validateArticles } from './articles.js';
import { writeJson, serverInfoPath, clearServerInfo } from './state.js';
import { PACKAGE_ROOT } from './scan.js';
import { usageTracker } from './usage.js';

const WEB_ROOT = join(PACKAGE_ROOT, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const IDLE_MS = 3 * 60 * 60 * 1000;
const MAX_BODY = 5 * 1024 * 1024;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function validRequest(body, scan) {
  const errors = [];
  const since = new Date(body.since);
  const until = new Date(body.until);
  if (Number.isNaN(since.getTime())) errors.push('since is not a date');
  if (Number.isNaN(until.getTime())) errors.push('until is not a date');
  if (!errors.length && since >= until) errors.push('since must be before until');
  const known = new Map(scan.sources.map((s) => [s.id, s]));
  const sources = Array.isArray(body.sources) ? body.sources.filter((id) => known.get(id)?.available) : [];
  if (!sources.length) errors.push('pick at least one available source');
  const style = scan.styles.find((s) => s.id === body.style) ?? scan.styles.find((s) => s.default) ?? scan.styles[0];
  if (errors.length) return { errors };
  return {
    request: {
      repo: scan.root,
      since: since.toISOString(),
      until: until.toISOString(),
      sources: sources.map((id) => ({ id, label: known.get(id).label, detail: known.get(id).detail })),
      style: style ? { id: style.id, label: style.label, guide: style.path } : null,
      instructions: String(body.instructions ?? '').slice(0, 4000),
      remote: scan.remote,
      contextFiles: scan.contextFiles,
      submittedAt: new Date().toISOString(),
    },
  };
}

// A restarted server carries on numbering, so it never overwrites an earlier edition's file.
function nextEdition(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {}
  const used = names.map((n) => /^edition-(\d+)\.json$/.exec(n)?.[1]).filter(Boolean).map(Number);
  return used.length ? Math.max(...used) + 1 : 1;
}

export function startServer({ dir, scan, port = 0, host = '127.0.0.1', projectsRoot, version = null, owner = null }) {
  const state = { phase: 'form', edition: nextEdition(dir), scan, request: null, status: [], articles: [], publishedAt: null, usage: null };
  let session = null;
  let tracker = null;
  let waiters = [];
  let idleTimer;

  const persist = () => writeJson(join(dir, 'state.json'), state);
  const flushWaiters = () => {
    const pending = waiters;
    waiters = [];
    for (const w of pending) w();
  };
  // The agent's CLI calls carry its Claude Code session id; while an edition is being written the
  // site counts the tokens that session (and its subagents) has used since the form was submitted.
  const noteSession = (url) => {
    const id = url.searchParams.get('session');
    if (id && id !== session) {
      session = id;
      tracker = null;
    }
  };
  const updateUsage = () => {
    if (state.phase !== 'generating' || !session || !state.request) return;
    tracker ??= usageTracker(session, state.request.submittedAt, projectsRoot);
    state.usage = tracker() ?? state.usage;
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shutdown(), IDLE_MS);
    idleTimer.unref?.();
  };

  const routes = {
    'GET /api/state': (req, res) => {
      updateUsage();
      send(res, 200, state);
    },

    'POST /api/generate': async (req, res) => {
      if (state.phase === 'generating') return send(res, 409, { errors: ['an edition is already being written'] });
      const { request, errors } = validRequest(await readBody(req), scan);
      if (errors) return send(res, 400, { errors });
      Object.assign(state, { phase: 'generating', request, status: [{ at: new Date().toISOString(), message: 'Copy desk received the assignment.' }], articles: [], publishedAt: null, usage: null });
      tracker = null;
      persist();
      flushWaiters();
      send(res, 200, { ok: true });
    },

    'GET /api/wait': (req, res, url) => {
      const timeout = Math.min(Number(url.searchParams.get('timeout')) || 540000, 3600000);
      const reply = () => send(res, 200, state.phase === 'generating' ? { pending: false, edition: state.edition, request: state.request } : { pending: true });
      if (state.phase === 'generating') return reply();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reply();
      };
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== finish);
        finish();
      }, timeout);
      waiters.push(finish);
      req.on('close', () => {
        waiters = waiters.filter((w) => w !== finish);
        clearTimeout(timer);
      });
    },

    'POST /api/status': async (req, res) => {
      const { message } = await readBody(req);
      if (!message) return send(res, 400, { errors: ['message is required'] });
      state.status.push({ at: new Date().toISOString(), message: String(message).slice(0, 300) });
      persist();
      send(res, 200, { ok: true });
    },

    'POST /api/publish': async (req, res) => {
      const result = validateArticles(await readBody(req));
      if (!result.ok) return send(res, 400, { errors: result.errors });
      updateUsage();
      Object.assign(state, { phase: 'published', articles: result.articles, publishedAt: new Date().toISOString() });
      persist();
      send(res, 200, { ok: true, articles: result.articles.length, usage: state.usage });
    },

    'POST /api/reset': (req, res) => {
      Object.assign(state, { phase: 'form', edition: state.edition + 1, request: null, status: [], articles: [], publishedAt: null, usage: null });
      tracker = null;
      persist();
      send(res, 200, { ok: true });
    },

    'POST /api/stop': (req, res) => {
      send(res, 200, { ok: true });
      setImmediate(shutdown);
    },
  };

  const server = createServer(async (req, res) => {
    touch();
    const url = new URL(req.url, 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    if (url.pathname.startsWith('/api/')) noteSession(url);
    try {
      if (route) return await route(req, res, url);
      if (req.method !== 'GET') return send(res, 404, { errors: ['not found'] });
      const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
      const file = join(WEB_ROOT, rel);
      if (!file.startsWith(WEB_ROOT)) return send(res, 404, { errors: ['not found'] });
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      if (err.code === 'ENOENT') return send(res, 404, { errors: ['not found'] });
      send(res, 400, { errors: [err.message] });
    }
  });

  function shutdown() {
    clearTimeout(idleTimer);
    flushWaiters();
    clearServerInfo(dir);
    server.close();
    server.closeAllConnections?.();
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      const info = { pid: process.pid, port: actual, url: `http://${host}:${actual}/`, root: scan.root, startedAt: new Date().toISOString(), version, owner };
      writeJson(serverInfoPath(dir), info);
      persist();
      touch();
      resolve({ server, info, state, shutdown });
    });
  });
}
