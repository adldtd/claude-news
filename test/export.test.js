import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { editionHtml, editionFilename } from '../src/export.js';
import { PACKAGE_ROOT } from '../src/scan.js';

const WEB_ROOT = join(PACKAGE_ROOT, 'web');

function published(overrides = {}) {
  return {
    phase: 'published',
    edition: 3,
    publishedAt: new Date(2026, 9, 2, 15, 30).toISOString(),
    scan: { name: 'claude-news', branch: 'main', root: '/home/someone/secret-path', user: { email: 'me@example.com' } },
    request: {
      repo: '/home/someone/secret-path',
      since: '2026-09-30T00:00:00Z',
      until: '2026-10-01T00:00:00Z',
      remote: { host: 'github.com', path: 'acme/claude-news', webUrl: 'https://github.com/acme/claude-news' },
      style: { id: 'broadsheet', label: 'Broadsheet', guide: '/abs/styles/broadsheet.md' },
      instructions: 'Lead with billing.',
      contextFiles: ['CLAUDE.md'],
    },
    usage: { total: 1160, input: 10, cacheWrite: 100, cacheRead: 1000, output: 50, messages: 1 },
    articles: [{ id: 'hello', headline: 'Hello', dek: '', section: 'General', size: 'breaking', byline: 'Staff', publishedAt: '2026-10-02T00:00:00Z', sources: [], body: 'Ends here </script><script>alert(1)</script>', words: 4 }],
    ...overrides,
  };
}

function embedded(html) {
  const m = /<script type="application\/json" id="edition-data">(.*?)<\/script>/s.exec(html);
  assert.ok(m, 'edition data is embedded');
  return JSON.parse(m[1]);
}

test('the filename names the repo, edition number and publish date', () => {
  assert.equal(editionFilename(published()), 'claude-news-edition-3-2026-10-02.html');
  assert.equal(editionFilename(published({ scan: { name: 'my "odd" repo' } })), 'my-odd-repo-edition-3-2026-10-02.html');
});

test('a saved edition inlines the viewer and carries the edition as data', async () => {
  const html = await editionHtml(published(), WEB_ROOT);
  assert.match(html, /<title>The claude-news Times<\/title>/);
  assert.match(html, /function renderNews/);
  assert.match(html, /marked v15/);
  assert.doesNotMatch(html, /<link rel="stylesheet" href="\/style\.css">|src="\//);
  const data = embedded(html);
  assert.equal(data.articles[0].body, 'Ends here </script><script>alert(1)</script>');
  assert.equal(data.request.instructions, 'Lead with billing.');
  assert.equal(data.request.style.label, 'Broadsheet');
  assert.equal(data.scan.branch, 'main');
  assert.equal(data.usage.total, 1160);
});

test('article text cannot close the data script', async () => {
  const html = await editionHtml(published(), WEB_ROOT);
  const start = html.indexOf('id="edition-data">');
  const end = html.indexOf('</script>', start);
  assert.doesNotMatch(html.slice(start, end), /<\/?script/i);
});

test('a saved edition leaves out local paths and the user', async () => {
  const html = await editionHtml(published(), WEB_ROOT);
  assert.doesNotMatch(html, /secret-path|me@example\.com|broadsheet\.md|CLAUDE\.md/);
});
