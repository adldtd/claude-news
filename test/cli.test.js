import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo, tempDir } from './helpers.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/claude-news.js', import.meta.url));
const env = { ...process.env, CLAUDE_NEWS_STATE_ROOT: tempDir('cn-state-') };
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

  assert.equal((await cn('status', 'Reading', 'commits')).code, 0);
  let state = await (await fetch(new URL('api/state', url))).json();
  assert.equal(state.phase, 'generating');
  assert.equal(state.status.at(-1).message, 'Reading commits');

  const badFile = join(tempDir(), 'bad.json');
  writeFileSync(badFile, JSON.stringify([{ headline: 'no body' }]));
  const rejected = await cn('publish', badFile);
  assert.equal(rejected.code, 1);
  assert.ok(rejected.json.errors.length);

  writeFileSync(got.json.articlesFile, JSON.stringify({ articles: [{ headline: 'Hello', body: 'World', size: 'breaking' }] }));
  const published = await cn('publish', got.json.articlesFile);
  assert.equal(published.code, 0);
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
