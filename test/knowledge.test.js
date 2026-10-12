import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scan } from '../src/scan.js';
import { KNOWLEDGE_VERSION, MAX_NEW_COMMITS, saveNotes, staleReason } from '../src/knowledge.js';
import { makeRepo } from './helpers.js';

const NOW = new Date('2026-10-01T12:00:00Z');
const commit = (repo, message) => {
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], { cwd: repo });
};

test('the first scan is full and later ones reuse what it found', () => {
  const repo = makeRepo({ files: { 'README.md': '# widgets\n' }, commits: [{ message: 'x', date: '2026-09-30T08:00:00Z' }] });
  const first = scan(repo, { now: NOW });
  assert.equal(first.knowledge.fullScan, true);
  assert.equal(first.knowledge.reason, 'no earlier scan');

  // A Linear link outside the context files is only found by a full scan.
  writeFileSync(join(repo, 'notes.txt'), 'see https://linear.app/acme\n');
  commit(repo, 'add notes');
  const second = scan(repo, { now: NOW });
  assert.equal(second.knowledge.fullScan, false);
  assert.equal(second.knowledge.scannedAt, first.knowledge.scannedAt);
  assert.ok(!second.sources.some((s) => s.id === 'linear'));

  const refreshed = scan(repo, { now: NOW, refresh: true });
  assert.equal(refreshed.knowledge.fullScan, true);
  assert.ok(refreshed.sources.some((s) => s.id === 'linear'));
});

test('a changed, added or removed context file sends the next scan back to a full one', () => {
  const repo = makeRepo({ files: { 'README.md': '# a\n' }, commits: [{ message: 'x', date: '2026-09-30T08:00:00Z' }] });
  scan(repo, { now: NOW });
  writeFileSync(join(repo, 'README.md'), '# b\n');
  assert.equal(scan(repo, { now: NOW }).knowledge.reason, 'the context files changed');
  assert.equal(scan(repo, { now: NOW }).knowledge.fullScan, false);
  writeFileSync(join(repo, 'CONTEXT.md'), '# Glossary\n');
  assert.equal(scan(repo, { now: NOW }).knowledge.reason, 'the context files changed');
});

test('the cache goes stale with many new commits, age, a lost commit or a new version', () => {
  const cached = { version: KNOWLEDGE_VERSION, scannedAt: NOW.toISOString(), contextHashes: { 'README.md': 'abc' } };
  const live = { contextHashes: { 'README.md': 'abc' }, commitsSince: 5 };
  assert.equal(staleReason(cached, live, NOW), null);
  assert.equal(staleReason(null, live, NOW), 'no earlier scan');
  assert.match(staleReason(cached, { ...live, commitsSince: MAX_NEW_COMMITS + 1 }, NOW), /301 new commits/);
  assert.match(staleReason(cached, { ...live, commitsSince: null }, NOW), /gone/);
  assert.match(staleReason(cached, live, new Date('2026-11-15T00:00:00Z')), /30 days/);
  assert.match(staleReason({ ...cached, version: 0 }, live, NOW), /changed what a full scan finds/);
});

test('notes stay fresh until the next full scan', () => {
  const repo = makeRepo({ files: { 'README.md': '# a\n' }, commits: [{ message: 'x', date: '2026-09-30T08:00:00Z' }] });
  assert.equal(saveNotes(repo, 'too early').ok, false);
  const root = scan(repo, { now: NOW }).root;
  assert.equal(scan(repo, { now: NOW }).knowledge.notes, null);
  assert.equal(saveNotes(root, '   ').ok, false);

  const saved = saveNotes(root, '# Notes\n\nA *widget* is a deployable unit.');
  assert.equal(saved.ok, true);
  assert.equal(saved.fresh, true);
  assert.equal(scan(repo, { now: NOW }).knowledge.notes.fresh, true);

  writeFileSync(join(repo, 'README.md'), '# b\n');
  const after = scan(repo, { now: NOW }).knowledge;
  assert.equal(after.fullScan, true);
  assert.equal(after.notes.fresh, false);
  assert.equal(saveNotes(root, '# Notes v2').fresh, true);
});
