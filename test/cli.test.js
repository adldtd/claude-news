import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, tempDir } from './helpers.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/claude-news.js', import.meta.url));
const SESSION = '0000aaaa-1111-2222-3333-444455556666';
const configDir = tempDir('cn-claude-');
const transcript = join(configDir, 'projects', '-some-project', `${SESSION}.jsonl`);
mkdirSync(join(configDir, 'projects', '-some-project'), { recursive: true });
writeFileSync(transcript, '');
const env = { ...process.env, CLAUDE_NEWS_STATE_ROOT: tempDir('cn-state-'), CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_SESSION_ID: SESSION };
const repo = makeRepo({ commits: [{ message: 'first', date: '2026-09-30T08:00:00Z' }] });

async function cn(...args) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args, '--repo', repo], { env });
    return { code: 0, json: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.code, json: JSON.parse(err.stdout) };
  }
}

after(() => cn('stop'));

test('scan outside a repo exits 1 with a reason', async () => {
  try {
    await run(process.execPath, [CLI, 'scan', '--repo', tempDir()], { env });
    assert.fail('expected a non-zero exit');
  } catch (err) {
    assert.equal(err.code, 1);
    assert.equal(JSON.parse(err.stdout).ok, false);
  }
});

test('commands before serve explain that the site is not running', async () => {
  const { code, json } = await cn('status', 'hello');
  assert.equal(code, 1);
  assert.match(json.reason, /not running/);
});

test('full round trip: serve, submit, wait, status, publish, reset, stop', async () => {
  const served = await cn('serve');
  assert.equal(served.code, 0);
  const url = served.json.url;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const again = await cn('serve');
  assert.equal(again.json.url, url);
  assert.equal(again.json.reused, true);

  const page = await fetch(url);
  assert.match(await page.text(), /Go to press/);

  const pending = await cn('wait', '--timeout', '1');
  assert.equal(pending.json.pending, true);

  const waiting = cn('wait', '--timeout', '30');
  const bad = await fetch(new URL('api/generate', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ since: 'x', until: 'y', sources: [] }) });
  assert.equal(bad.status, 400);

  const submit = await fetch(new URL('api/generate', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ since: '2026-09-30T00:00:00Z', until: '2026-10-01T00:00:00Z', sources: ['git', 'nope'], style: 'broadsheet', instructions: 'be brief' }),
  });
  assert.equal(submit.status, 200);

  const got = await waiting;
  assert.equal(got.json.pending, false);
  assert.deepEqual(got.json.request.sources.map((s) => s.id), ['git']);
  assert.equal(got.json.request.instructions, 'be brief');
  assert.match(got.json.request.style.guide, /broadsheet\.md$/);
  assert.ok(got.json.articlesFile);

  const later = new Date(Date.now() + 60000).toISOString();
  const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 };
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: later, message: { id: 'm1', usage } }) + '\n');
  assert.equal((await cn('status', 'Reading', 'commits')).code, 0);
  let state = await (await fetch(new URL('api/state', url))).json();
  assert.equal(state.phase, 'generating');
  assert.equal(state.status.at(-1).message, 'Reading commits');
  assert.equal(state.usage.total, 1160);

  const badFile = join(tempDir(), 'bad.json');
  writeFileSync(badFile, JSON.stringify([{ headline: 'no body' }]));
  const rejected = await cn('publish', badFile);
  assert.equal(rejected.code, 1);
  assert.ok(rejected.json.errors.length);

  writeFileSync(got.json.articlesFile, JSON.stringify({ articles: [{ headline: 'Hello', body: 'World', size: 'breaking' }] }));
  const published = await cn('publish', got.json.articlesFile);
  assert.equal(published.code, 0);
  assert.equal(published.json.usage.output, 50);
  state = await (await fetch(new URL('api/state', url))).json();
  assert.equal(state.phase, 'published');
  assert.equal(state.articles[0].size, 'breaking');

  await fetch(new URL('api/reset', url), { method: 'POST' });
  state = await (await fetch(new URL('api/state', url))).json();
  assert.equal(state.phase, 'form');
  assert.equal(state.edition, 2);

  const stopped = await cn('stop');
  assert.equal(stopped.json.wasRunning, true);
  assert.equal((await cn('stop')).json.wasRunning, false);
});

test('static files cannot escape the web root', async () => {
  const { json } = await cn('serve');
  const r = await fetch(new URL('/..%2f..%2fpackage.json', json.url));
  assert.equal(r.status, 404);
});

function serveForeground() {
  const child = spawn(process.execPath, [CLI, 'serve', '--foreground', '--repo', repo], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const started = new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk;
      try {
        resolve(JSON.parse(text));
      } catch {}
    });
    child.once('exit', () => reject(new Error(`foreground serve exited early: ${text}`)));
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, started, exited };
}

test('serve replaces a running server started from other code', async () => {
  const first = await cn('serve');
  const infoFile = join(first.json.stateDir, 'server.json');
  const info = JSON.parse(readFileSync(infoFile, 'utf8'));
  writeFileSync(infoFile, JSON.stringify({ ...info, version: 'stale' }));

  const second = await cn('serve');
  assert.equal(second.code, 0);
  assert.equal(second.json.reused, false);
  assert.equal(second.json.replaced, true);
  assert.notEqual(JSON.parse(readFileSync(infoFile, 'utf8')).version, 'stale');
  assert.equal((await cn('serve')).json.reused, true);
  await cn('stop');
});

test('a foreground server belongs to its session and stops with its process', async () => {
  const detached = await cn('serve');
  assert.equal(detached.code, 0);

  const fg = serveForeground();
  const started = await fg.started;
  assert.equal(started.ok, true);
  assert.equal(started.foreground, true);
  assert.equal(started.replaced, true);

  const found = await cn('url');
  assert.equal(found.code, 0);
  assert.equal(found.json.url, started.url);
  assert.equal((await cn('serve')).json.reused, true);

  fg.child.kill('SIGTERM');
  await fg.exited;
  const after = await cn('status', 'hello');
  assert.equal(after.code, 1);
  assert.match(after.json.reason, /not running/);
  assert.equal((await cn('url', '--timeout', '1')).code, 1);
});

test('stop ends a foreground server process', async () => {
  const fg = serveForeground();
  await fg.started;
  assert.equal((await cn('stop')).json.wasRunning, true);
  const { code } = await fg.exited;
  assert.equal(code, 0);
});

test('a restarted server numbers editions after the saved ones', async () => {
  const served = await cn('serve');
  writeFileSync(join(served.json.stateDir, 'edition-7.json'), '{}');
  await cn('stop');
  const again = await cn('serve');
  const state = await (await fetch(new URL('api/state', again.json.url))).json();
  assert.equal(state.edition, 8);
  await cn('stop');
});
