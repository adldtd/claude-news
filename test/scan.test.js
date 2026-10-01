import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { scan, parseRemote, ticketPrefixes } from '../src/scan.js';
import { makeRepo, tempDir } from './helpers.js';

const NOW = new Date('2026-10-01T12:00:00Z');

test('a directory outside git is refused with a reason', () => {
  const result = scan(tempDir());
  assert.equal(result.ok, false);
  assert.match(result.reason, /not inside a git repository/);
});

test('a repo with no commits is refused', () => {
  const result = scan(makeRepo());
  assert.equal(result.ok, false);
  assert.match(result.reason, /no commit history/);
});

test('since defaults to the user\'s last commit', () => {
  const repo = makeRepo({
    commits: [
      { message: 'mine', date: '2026-09-30T08:00:00Z' },
      { message: 'theirs', date: '2026-09-30T20:00:00Z', email: 'other@example.com', name: 'Other' },
    ],
  });
  const result = scan(repo, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.defaults.since, '2026-09-30T08:00:00.000Z');
  assert.equal(result.defaults.until, NOW.toISOString());
  assert.equal(result.lastUserCommit.subject, 'mine');
});

test('since falls back to 24 hours when the user has no commits', () => {
  const repo = makeRepo({ email: 'nobody@example.com', commits: [{ message: 'x', date: '2026-09-30T08:00:00Z', email: 'other@example.com', name: 'Other' }] });
  const result = scan(repo, { now: NOW });
  assert.equal(result.lastUserCommit, null);
  assert.equal(result.defaults.since, '2026-09-30T12:00:00.000Z');
});

test('git is always a source and a GitHub remote adds GitHub sources', () => {
  const repo = makeRepo({ commits: [{ message: 'x', date: '2026-09-30T08:00:00Z' }], remote: 'git@github.com:acme/widgets.git' });
  const result = scan(repo, { now: NOW });
  const ids = result.sources.map((s) => s.id);
  assert.ok(ids.includes('git'));
  assert.ok(ids.includes('github-prs'));
  assert.deepEqual(result.remote, { host: 'github.com', path: 'acme/widgets', webUrl: 'https://github.com/acme/widgets' });
});

test('a repo with no remote offers no GitHub sources', () => {
  const repo = makeRepo({ commits: [{ message: 'x', date: '2026-09-30T08:00:00Z' }] });
  const ids = scan(repo).sources.map((s) => s.id);
  assert.deepEqual(ids, ['git']);
});

test('linear is detected from a linear.app link and ticket keys from commits', () => {
  const repo = makeRepo({
    files: { 'CONTRIBUTING.md': 'Track work at https://linear.app/acme\n', 'docs/a.md': '# a\n', 'CHANGELOG.md': '# Changes\n' },
    commits: ['WID-1 a', 'WID-2 b', 'fix WID-3'].map((message, i) => ({ message, date: `2026-09-30T0${i}:00:00Z` })),
  });
  const result = scan(repo);
  const ids = result.sources.map((s) => s.id);
  assert.ok(ids.includes('linear'));
  assert.ok(!ids.includes('jira'));
  assert.ok(ids.includes('docs'));
  assert.ok(ids.includes('changelog'));
  assert.deepEqual(result.ticketPrefixes, ['WID']);
});

test('a single passing mention of jira is not enough to offer it', () => {
  const repo = makeRepo({ files: { 'README.md': 'We moved off Jira years ago.\n' }, commits: [{ message: 'x', date: '2026-09-30T08:00:00Z' }] });
  assert.ok(!scan(repo).sources.some((s) => s.id === 'jira'));
});

test('ticket prefixes ignore standards names and lowercase words in messages', () => {
  const messages = ['use UTF-8', 'ISO-8601 dates', 'step-1 step-2 step-3', 'SHA-256 SHA-256 SHA-256'];
  assert.deepEqual(ticketPrefixes(messages), []);
  assert.deepEqual(ticketPrefixes([], ['me/fun-1-a', 'me/fun-2-b', 'origin/fun-3']), ['FUN']);
});

test('remotes in https and ssh forms parse to a web URL', () => {
  assert.equal(parseRemote('https://github.com/a/b.git').webUrl, 'https://github.com/a/b');
  assert.equal(parseRemote('ssh://git@gitlab.com/g/sub/p.git').webUrl, 'https://gitlab.com/g/sub/p');
  assert.equal(parseRemote(''), null);
});

test('a last commit less than 24 hours old widens the default window to 24 hours', () => {
  const repo = makeRepo({ commits: [{ message: 'just now', date: '2026-10-01T11:50:00Z' }] });
  const result = scan(repo, { now: NOW });
  assert.equal(result.defaults.since, '2026-09-30T12:00:00.000Z');
  assert.match(result.defaults.sinceReason, /last 24 hours/);
});

test('merge commits do not count as the user\'s last commit', () => {
  const repo = makeRepo({ commits: [{ message: 'real work', date: '2026-09-29T08:00:00Z' }] });
  const git = (...args) => execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-01T11:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T11:00:00Z' } });
  git('checkout', '-q', '-b', 'side');
  git('commit', '-q', '--allow-empty', '-m', 'side work', '--author', 'Other <other@example.com>');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', 'side', '-m', 'Merge side');
  const result = scan(repo, { now: NOW });
  assert.equal(result.lastUserCommit.subject, 'real work');
  assert.equal(result.defaults.since, '2026-09-29T08:00:00.000Z');
});

test('the last commit reports its branches and whether it has been pushed', () => {
  const repo = makeRepo({ commits: [{ message: 'mine', date: '2026-09-30T08:00:00Z' }] });
  const result = scan(repo, { now: NOW });
  assert.deepEqual(result.lastUserCommit.branches, ['main']);
  assert.equal(result.lastUserCommit.pushed, false);
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: repo });
  assert.equal(scan(repo, { now: NOW }).lastUserCommit.pushed, true);
});
