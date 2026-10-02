import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FONTS = 'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;700;800;900&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline code must not close its own element early; `<\/` means the same thing inside JS and CSS strings.
const inline = (code, tag) => code.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');

// JSON inside a script element: escape `<` so article text can never close it, and the two line
// separators JavaScript once treated as newlines.
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const pad = (n) => String(n).padStart(2, '0');

export function editionFilename(state) {
  const d = new Date(state.publishedAt);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const repo = String(state.scan?.name ?? 'claude-news').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'claude-news';
  return `${repo}-edition-${state.edition}-${date}.html`;
}

// Only what the reader shows goes into the file: no local paths, emails or scan details.
function savedState(state) {
  const { request, scan } = state;
  return {
    phase: 'published',
    edition: state.edition,
    publishedAt: state.publishedAt,
    scan: { name: scan?.name ?? null, branch: scan?.branch ?? null },
    request: request && {
      since: request.since,
      until: request.until,
      remote: request.remote ? { host: request.remote.host, path: request.remote.path } : null,
      style: request.style ? { label: request.style.label } : null,
      instructions: request.instructions,
    },
    usage: state.usage,
    articles: state.articles,
  };
}

// A published edition as one HTML file: the live site's styles, viewer and Markdown renderer
// inlined, with the edition's data alongside, so it reads the same with no server behind it.
export async function editionHtml(state, webRoot) {
  const [css, marked, viewer] = await Promise.all(
    ['style.css', 'vendor/marked.min.js', 'viewer.js'].map((f) => readFile(join(webRoot, f), 'utf8')),
  );
  const title = escapeHtml(`The ${state.scan?.name ?? 'Claude'} Times`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="claude-news">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS}">
  <style>
${inline(css, 'style')}
  </style>
</head>
<body data-phase="published">
  <header class="topbar">
    <h1 class="topbar-title" id="masthead-title">${title}</h1>
    <p class="topbar-motto">All the commits that are fit to print</p>
  </header>
  <div class="dateline">
    <span id="rail-date"></span>
    <span class="dateline-meta" id="rail-meta"></span>
  </div>

  <main id="view-news" class="view newsroom">
    <nav class="slider" aria-label="Articles">
      <div class="slider-head">
        <span class="kicker">In this edition</span>
      </div>
      <ol class="slider-list" id="slider-list"></ol>
      <footer class="colophon">
        <p class="kicker">About this edition</p>
        <dl class="colophon-list" id="colophon-list"></dl>
        <p class="tokens" id="news-tokens" hidden></p>
      </footer>
    </nav>
    <div class="reader-pane" id="reader-pane">
      <article class="reader" id="reader" tabindex="-1"></article>
    </div>
  </main>

  <script type="application/json" id="edition-data">${scriptJson(savedState(state))}</script>
  <script>
${inline(marked, 'script')}
  </script>
  <script>
${inline(viewer, 'script')}
  </script>
  <script>
    const state = JSON.parse(document.getElementById('edition-data').textContent);
    masthead(state);
    renderNews(state);
    initViewer();
  </script>
</body>
</html>
`;
}
