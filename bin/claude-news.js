#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/scan.js';
import { stateDir, readServerInfo, clearServerInfo, readJson } from '../src/state.js';
import { validateArticles } from '../src/articles.js';
import { startServer } from '../src/server.js';
import { codeVersion } from '../src/version.js';

const USAGE = `claude-news <command> [options]

Commands
  scan     [--repo PATH]                 check git access and detect sources
  serve    [--repo PATH] [--foreground]  start (or reuse) the site and print its URL; with
                                         --foreground the site runs in this process and stops with it
  url      [--repo PATH] [--timeout S]   wait for this session's site (default 15s) and print its URL
  wait     [--repo PATH] [--timeout S]   block until the user presses Generate (default 540s)
  status   [--repo PATH] <message>       show a progress line on the site
  publish  [--repo PATH] <articles.json> validate and publish the edition
  stop     [--repo PATH]                 stop the site

Every command prints JSON.`;

const FLAGS = new Set(['foreground']);

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) opts[k] = v;
      else if (FLAGS.has(k)) opts[k] = true;
      else opts[k] = argv[++i];
    } else rest.push(a);
  }
  return { opts, rest };
}

function out(value, code = 0) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  process.exitCode = code;
}

function scanOrExit(repo) {
  const result = scan(resolve(repo ?? process.cwd()));
  if (!result.ok) {
    out(result, 1);
    return null;
  }
  return result;
}

async function alive(info) {
  if (!info) return false;
  try {
    const r = await fetch(new URL('api/state', info.url), { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function server(repo) {
  const result = scanOrExit(repo);
  if (!result) return null;
  const dir = stateDir(result.root);
  const info = readServerInfo(dir);
  if (!(await alive(info))) {
    out({ ok: false, reason: 'claude-news is not running for this repo; run `claude-news serve` first.' }, 1);
    return null;
  }
  return { info, dir, root: result.root };
}

// Lets the site count the tokens this Claude Code session spends writing the edition.
const SESSION = process.env.CLAUDE_CODE_SESSION_ID;
const VERSION = codeVersion();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(info, method, path, body, signal) {
  const url = new URL(path, info.url);
  if (SESSION) url.searchParams.set('session', SESSION);
  const r = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  return { status: r.status, json: await r.json() };
}

async function stopServer(info, dir) {
  try {
    await api(info, 'POST', 'api/stop');
  } catch {}
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (await alive(info))) await sleep(100);
  clearServerInfo(dir);
}

// A foreground server belongs to the session that started it; a detached one to nobody.
function reusable(info, owner) {
  return info.version === VERSION && (owner === null || info.owner === owner);
}

const commands = {
  async scan({ opts }) {
    const result = scanOrExit(opts.repo);
    if (result) out(result);
  },

  async serve({ opts }) {
    const result = scanOrExit(opts.repo);
    if (!result) return;
    const dir = stateDir(result.root);
    const foreground = opts.foreground === true;
    const owner = foreground ? (SESSION ?? null) : null;
    const existing = readServerInfo(dir);
    let replaced = false;
    if (await alive(existing)) {
      if (reusable(existing, owner)) return out({ ok: true, url: existing.url, reused: true, stateDir: dir });
      await stopServer(existing, dir);
      replaced = true;
    }
    clearServerInfo(dir);

    if (foreground) {
      const { info, shutdown } = await startServer({ dir, scan: result, port: Number(opts.port) || 0, version: VERSION, owner });
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(signal, () => {
          shutdown();
          process.exit(0);
        });
      }
      return out({ ok: true, url: info.url, reused: false, replaced, foreground: true, stateDir: dir });
    }

    const self = fileURLToPath(import.meta.url);
    const args = [self, '__server', '--repo', result.root];
    if (opts.port) args.push('--port', opts.port);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const info = readServerInfo(dir);
      if (await alive(info)) return out({ ok: true, url: info.url, reused: false, replaced, stateDir: dir });
      await sleep(150);
    }
    out({ ok: false, reason: 'the server did not start within 8 seconds' }, 1);
  },

  async __server({ opts }) {
    const result = scan(resolve(opts.repo));
    if (!result.ok) process.exit(1);
    await startServer({ dir: stateDir(result.root), scan: result, port: Number(opts.port) || 0, version: VERSION });
  },

  async url({ opts }) {
    const result = scanOrExit(opts.repo);
    if (!result) return;
    const dir = stateDir(result.root);
    const owner = SESSION ?? null;
    const deadline = Date.now() + (Number(opts.timeout) || 15) * 1000;
    while (Date.now() < deadline) {
      const info = readServerInfo(dir);
      if (info && reusable(info, owner) && (await alive(info))) return out({ ok: true, url: info.url, stateDir: dir });
      await sleep(150);
    }
    out({ ok: false, reason: "this session's site is not running; start it with `claude-news serve --foreground`" }, 1);
  },

  async wait({ opts }) {
    const s = await server(opts.repo);
    if (!s) return;
    const seconds = Number(opts.timeout) || 540;
    const { json } = await api(s.info, 'GET', `api/wait?timeout=${seconds * 1000}`, null, AbortSignal.timeout((seconds + 30) * 1000));
    if (json.pending) return out({ pending: true, hint: 'No submission yet. Run `claude-news wait` again.' });
    out({ ...json, stateDir: s.dir, articlesFile: resolve(s.dir, `edition-${json.edition}.json`) });
  },

  async status({ opts, rest }) {
    const s = await server(opts.repo);
    if (!s) return;
    const message = rest.join(' ').trim();
    if (!message) return out({ ok: false, reason: 'status needs a message' }, 1);
    const { status, json } = await api(s.info, 'POST', 'api/status', { message });
    out(json, status === 200 ? 0 : 1);
  },

  async publish({ opts, rest }) {
    if (!rest[0]) return out({ ok: false, reason: 'publish needs a path to an articles JSON file' }, 1);
    const data = readJson(resolve(rest[0]));
    if (data === null) return out({ ok: false, errors: [`could not read JSON from ${rest[0]}`] }, 1);
    const local = validateArticles(data);
    if (!local.ok) return out({ ok: false, errors: local.errors }, 1);
    const s = await server(opts.repo);
    if (!s) return;
    const { status, json } = await api(s.info, 'POST', 'api/publish', data);
    out(status === 200 ? { ...json, url: s.info.url } : { ok: false, ...json }, status === 200 ? 0 : 1);
  },

  async stop({ opts }) {
    const result = scanOrExit(opts.repo);
    if (!result) return;
    const dir = stateDir(result.root);
    const info = readServerInfo(dir);
    if (!(await alive(info))) {
      clearServerInfo(dir);
      return out({ ok: true, wasRunning: false });
    }
    await api(info, 'POST', 'api/stop');
    out({ ok: true, wasRunning: true });
  },
};

const [cmd, ...argv] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h' || !commands[cmd]) {
  process.stdout.write(USAGE + '\n');
  process.exitCode = cmd && !['--help', '-h'].includes(cmd) ? 1 : 0;
} else {
  commands[cmd](parseArgs(argv)).catch((err) => out({ ok: false, reason: err.message }, 1));
}
