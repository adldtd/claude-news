import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../src/scan.js';

const WEB_ROOT = join(PACKAGE_ROOT, 'web');

function declarations(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is styled`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return body.split(';').map((d) => d.trim()).filter(Boolean);
}

test('a chosen dark theme uses the same tokens as a dark system', async () => {
  const css = await readFile(join(WEB_ROOT, 'style.css'), 'utf8');
  const system = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  assert.deepEqual(declarations(css, ':root[data-theme="dark"]'), declarations(system, ':root:not([data-theme="light"])'));
});

test('printing stays light whatever theme the reader chose', async () => {
  const css = await readFile(join(WEB_ROOT, 'style.css'), 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  assert.match(print, /:root, :root:not\(\[data-theme="light"\]\), :root\[data-theme="dark"\] \{[^}]*color-scheme: light/);
});

test('the page applies a saved theme before it loads its stylesheet', async () => {
  const html = await readFile(join(WEB_ROOT, 'index.html'), 'utf8');
  const script = html.indexOf("localStorage.getItem('claude-news:theme')");
  assert.ok(script >= 0, 'the saved theme is read');
  assert.ok(script < html.indexOf('<link rel="stylesheet" href="/style.css">'), 'and read before first paint');
  assert.match(html, /role="menuitem" id="menu-theme"/);
});
