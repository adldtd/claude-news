const $ = (id) => document.getElementById(id);
const VIEWS = { loading: 'view-loading', form: 'view-form', generating: 'view-press', published: 'view-news' };
const SIZE_RANK = { breaking: 0, major: 1, standard: 2 };

let phase = null;
let edition = null;
let statusCount = -1;
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

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, opts);
}

function showView(name) {
  for (const [key, id] of Object.entries(VIEWS)) $(id).hidden = key !== name;
  document.body.dataset.phase = name;
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

function masthead(state) {
  const name = state.scan?.name ?? 'Claude';
  $('masthead-title').textContent = `The ${name} Times`;
  document.title = `The ${name} Times`;
  $('rail-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const opts = { dateStyle: 'medium', timeStyle: 'short' };
  $('rail-meta').textContent = state.request ? `Covering ${formatDate(state.request.since, opts)} – ${formatDate(state.request.until, opts)}` : '';
}

function renderForm(state) {
  const { scan } = state;
  const repo = $('f-repo');
  repo.replaceChildren(el('option', { value: scan.root, selected: true, text: scan.remote ? `${scan.remote.path}  (${scan.root})` : scan.root }));
  $('f-repo-hint').textContent = `Branch ${scan.branch}`;

  $('f-since').value = toLocalInput(scan.defaults.since);
  $('f-until').value = toLocalInput(new Date().toISOString());
  $('f-since-hint').textContent = scan.defaults.sinceReason === 'your last commit'
    ? `From your last commit: “${scan.lastUserCommit.subject}”`
    : `Defaulted to ${scan.defaults.sinceReason}`;

  $('f-sources').replaceChildren(
    ...scan.sources.map((s) =>
      el('label', { class: `source${s.available ? '' : ' is-off'}` },
        el('input', { type: 'checkbox', name: 'source', value: s.id, checked: s.defaultOn, disabled: !s.available }),
        el('span', { class: 'source-name', text: s.label }),
        el('span', { class: 'source-detail', text: s.detail }),
      ),
    ),
  );

  const style = $('f-style');
  style.replaceChildren(...scan.styles.map((s) => el('option', { value: s.id, selected: s.default, text: s.label })));
  const describeStyle = () => {
    $('f-style-hint').textContent = scan.styles.find((s) => s.id === style.value)?.description ?? '';
  };
  style.onchange = describeStyle;
  describeStyle();

  $('f-instructions').value = '';
  $('form-errors').textContent = '';
  $('f-submit').disabled = false;
}

async function submitForm(event) {
  event.preventDefault();
  const errors = $('form-errors');
  errors.textContent = '';
  const since = new Date($('f-since').value);
  const until = new Date($('f-until').value);
  const sources = [...document.querySelectorAll('input[name="source"]:checked')].map((i) => i.value);
  if (!sources.length) return void (errors.textContent = 'Pick at least one wire to read.');
  if (!(since < until)) return void (errors.textContent = '“Since” has to come before “Until”.');

  $('f-submit').disabled = true;
  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        since: since.toISOString(),
        until: until.toISOString(),
        sources,
        style: $('f-style').value,
        instructions: $('f-instructions').value,
      }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error((body.errors ?? ['Something went wrong.']).join(' '));
    await refresh();
  } catch (err) {
    errors.textContent = err.message;
    $('f-submit').disabled = false;
  }
}

function renderPress(state) {
  renderTokens($('press-tokens'), state.usage, '');
  if (state.status.length === statusCount) return;
  statusCount = state.status.length;
  $('wire').replaceChildren(...state.status.slice(-5).reverse().map((s) => el('li', { title: formatDate(s.at), text: s.message })));
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
  reader.replaceChildren(...[
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
  ].filter(Boolean));
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
  renderTokens($('news-tokens'), state.usage, 'Written with ');
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (!articles.some((a) => a.id === selectedId)) selectedId = articles.some((a) => a.id === fromHash) ? fromHash : articles[0]?.id;
  renderSlider(articles);
  selectArticle(articles, selectedId);
}

async function refresh() {
  let state;
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    state = await r.json();
  } catch {
    return;
  }
  const changed = state.phase !== phase || state.edition !== edition;
  if (changed) {
    phase = state.phase;
    edition = state.edition;
    statusCount = -1;
    masthead(state);
    showView(phase);
    if (phase === 'form') renderForm(state);
    if (phase === 'published') renderNews(state);
  }
  if (phase === 'generating') renderPress(state);
}

$('assignment-form').addEventListener('submit', submitForm);
$('reader').addEventListener('click', followArticleLink);
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (phase === 'published' && id !== selectedId && currentArticles.some((a) => a.id === id)) selectArticle(currentArticles, id, true);
});
$('new-edition').addEventListener('click', async () => {
  if (!confirm('Start a new edition? The current one will be cleared from this page.')) return;
  await fetch('/api/reset', { method: 'POST' });
  selectedId = null;
  try { history.replaceState(null, '', location.pathname); } catch {}
  await refresh();
});

refresh();
setInterval(refresh, 1500);
