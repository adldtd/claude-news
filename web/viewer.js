// Renders a published edition: masthead, slider, reader, colophon and the print layout.
// The live site loads this before app.js; a saved edition inlines it and calls the same functions.
const $ = (id) => document.getElementById(id);
const SIZE_RANK = { breaking: 0, major: 1, standard: 2 };

let selectedId = null;
let currentArticles = [];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function formatDate(iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, opts);
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function renderTokens(node, usage, prefix) {
  node.hidden = !usage;
  if (!usage) return;
  node.textContent = `${prefix}${compact.format(usage.total)} tokens · ${compact.format(usage.output)} output`;
  node.title = [
    `Input: ${usage.input.toLocaleString()}`,
    `Cache writes: ${usage.cacheWrite.toLocaleString()}`,
    `Cache reads: ${usage.cacheRead.toLocaleString()}`,
    `Output: ${usage.output.toLocaleString()}`,
    `${usage.messages} model calls, subagents included`,
  ].join('\n');
}

// A published edition is dated the day it went to press, not the day it is read.
function masthead(state) {
  const name = state.scan?.name ?? 'Claude';
  $('masthead-title').textContent = `The ${name} Times`;
  document.title = `The ${name} Times`;
  $('rail-date').textContent = new Date(state.publishedAt ?? Date.now()).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const opts = { dateStyle: 'medium', timeStyle: 'short' };
  $('rail-meta').textContent = state.request ? `Covering ${formatDate(state.request.since, opts)} – ${formatDate(state.request.until, opts)}` : '';
}

function sortedArticles(state) {
  return state.articles
    .map((a, i) => ({ a, i }))
    .sort((x, y) => SIZE_RANK[x.a.size] - SIZE_RANK[y.a.size] || x.i - y.i)
    .map(({ a }) => a);
}

function renderSlider(articles) {
  $('slider-list').replaceChildren(
    ...articles.map((a) =>
      el('li', {},
        el('button', {
          type: 'button',
          class: `card card--${a.size}`,
          'aria-current': a.id === selectedId ? 'true' : 'false',
          'data-id': a.id,
          onclick: () => selectArticle(articles, a.id, true),
        },
          el('p', { class: 'kicker', text: a.size === 'breaking' ? 'Breaking' : a.section }),
          el('h3', { class: 'card-headline', text: a.headline }),
          a.dek ? el('p', { class: 'card-dek', text: a.dek }) : null,
          el('p', { class: 'card-meta', text: `${a.words} words · ${a.byline}` }),
        ),
      ),
    ),
  );
}

function renderColophon(state) {
  const { request, scan } = state;
  const repo = request?.remote?.path ?? scan?.name;
  const rows = [
    ['Edition', `No. ${state.edition}`],
    ['Repository', repo && scan?.branch ? `${repo} · ${scan.branch}` : repo],
    ['House style', request?.style?.label],
    ["Editor's notes", request?.instructions?.trim()],
  ].filter(([, v]) => v);
  $('colophon-list').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  renderTokens($('news-tokens'), state.usage, 'Written with ');
}

function safeMarkdown(markdown) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  window.marked.use({ renderer: { html: ({ text }) => escape(text) } });
  const html = window.marked.parse(markdown, { gfm: true });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const a of tpl.content.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) continue;
    if (!/^(https?:|mailto:)/i.test(href)) a.removeAttribute('href');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  for (const img of tpl.content.querySelectorAll('img')) {
    if (!/^https?:/i.test(img.getAttribute('src') ?? '')) img.remove();
  }
  return tpl.content;
}

function articleNodes(a) {
  return [
    el('p', { class: 'kicker', text: a.size === 'breaking' ? `Breaking · ${a.section}` : a.section }),
    el('h2', { class: 'reader-headline', text: a.headline }),
    a.dek ? el('p', { class: 'reader-dek', text: a.dek }) : null,
    el('div', { class: 'reader-byline' },
      el('span', {}, 'By ', el('strong', { text: a.byline })),
      el('time', { datetime: a.publishedAt, text: formatDate(a.publishedAt) }),
      el('span', { text: `${a.words} words` }),
    ),
    el('div', { class: 'reader-body' }, safeMarkdown(a.body)),
    a.sources.length
      ? el('aside', { class: 'reader-sources' },
          el('p', { class: 'kicker', text: 'Sources' }),
          el('ul', {}, ...a.sources.map((s) => el('li', {}, el('a', { href: /^https?:/i.test(s.url) ? s.url : null, target: '_blank', rel: 'noopener noreferrer', text: s.label })))),
        )
      : null,
  ].filter(Boolean);
}

function selectArticle(articles, id, focus = false) {
  const a = articles.find((x) => x.id === id) ?? articles[0];
  if (!a) {
    $('reader').replaceChildren(el('p', { class: 'reader-empty', text: 'No stories in this edition.' }));
    return;
  }
  selectedId = a.id;
  try { history.replaceState(null, '', `#${encodeURIComponent(a.id)}`); } catch {}
  for (const card of document.querySelectorAll('.card')) card.setAttribute('aria-current', String(card.dataset.id === a.id));

  const reader = $('reader');
  reader.className = `reader reader--${a.size}`;
  reader.replaceChildren(...articleNodes(a));
  $('reader-pane').scrollTop = 0;
  if (focus) reader.focus({ preventScroll: true });
}

// Links between articles (`#other-article-id`) switch stories in place instead of opening a tab.
function followArticleLink(event) {
  const link = event.target.closest('a[href^="#"]');
  if (!link || !currentArticles.length) return;
  const id = decodeURIComponent(link.getAttribute('href').slice(1));
  if (!currentArticles.some((a) => a.id === id)) return;
  event.preventDefault();
  selectArticle(currentArticles, id, true);
}

function renderNews(state) {
  const articles = sortedArticles(state);
  currentArticles = articles;
  renderColophon(state);
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (!articles.some((a) => a.id === selectedId)) selectedId = articles.some((a) => a.id === fromHash) ? fromHash : articles[0]?.id;
  renderSlider(articles);
  selectArticle(articles, selectedId);
}

function resetNews() {
  selectedId = null;
  currentArticles = [];
}

// The screen shows one article at a time; on paper the whole edition runs in order.
function renderPrintEdition() {
  let sheet = $('print-edition');
  if (!sheet) {
    sheet = el('div', { id: 'print-edition', class: 'print-edition' });
    $('view-news').append(sheet);
  }
  sheet.replaceChildren(...currentArticles.map((a) => el('article', { class: `reader reader--${a.size} print-article` }, ...articleNodes(a))));
}

function initViewer() {
  $('reader').addEventListener('click', followArticleLink);
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (document.body.dataset.phase === 'published' && id !== selectedId && currentArticles.some((a) => a.id === id)) selectArticle(currentArticles, id, true);
  });
  window.addEventListener('beforeprint', () => {
    if (document.body.dataset.phase === 'published') renderPrintEdition();
  });
}
