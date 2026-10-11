const VIEWS = { loading: 'view-loading', form: 'view-form', generating: 'view-press', published: 'view-news' };

let phase = null;
let edition = null;
let statusCount = -1;

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showView(name) {
  for (const [key, id] of Object.entries(VIEWS)) $(id).hidden = key !== name;
  document.body.dataset.phase = name;
}

// Ticks the sources and picks the style; `chosen` is the saved preferences or the scan's defaults.
function applyChoices(chosen) {
  for (const input of document.querySelectorAll('input[name="source"]')) input.checked = Boolean(chosen.sources[input.value]);
  $('f-style').value = chosen.style ?? '';
  $('f-style').onchange?.();
}

function renderForm(state) {
  const { scan, preferences } = state;
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
        el('input', { type: 'checkbox', name: 'source', value: s.id, disabled: !s.available }),
        el('span', { class: 'source-name', text: s.label }),
        el('span', { class: 'source-detail', text: s.detail }),
      ),
    ),
  );

  const style = $('f-style');
  style.replaceChildren(...scan.styles.map((s) => el('option', { value: s.id, text: s.label })));
  style.onchange = () => {
    $('f-style-hint').textContent = scan.styles.find((s) => s.id === style.value)?.description ?? '';
  };

  const defaults = {
    sources: Object.fromEntries(scan.sources.map((s) => [s.id, s.defaultOn])),
    style: scan.styles.find((s) => s.default)?.id ?? scan.styles[0]?.id,
  };
  applyChoices(preferences ?? defaults);
  const hint = $('f-sources-hint');
  hint.hidden = !preferences?.remembered;
  $('f-sources-reset').onclick = () => {
    applyChoices(defaults);
    hint.hidden = true;
  };

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
    // The menu is always there for the theme; the edition's own items wait for a published edition.
    $('edition-menu').hidden = false;
    for (const item of document.querySelectorAll('[data-edition-only]')) item.hidden = phase !== 'published';
    $('menu-list').hidden = true;
    $('menu-button').setAttribute('aria-expanded', 'false');
    if (phase === 'published') renderNews(state);
  }
  if (phase === 'generating') renderPress(state);
}

async function newEdition() {
  if (!confirm('Start a new edition? The current one will be cleared from this page.')) return;
  await fetch('/api/reset', { method: 'POST' });
  resetNews();
  try { history.replaceState(null, '', location.pathname); } catch {}
  await refresh();
}

// The reader's light/dark choice, remembered per browser. The page applies a saved one before
// first paint (see index.html); with none saved it follows the system theme.
const THEME_KEY = 'claude-news:theme';
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme ?? (darkScheme.matches ? 'dark' : 'light');

function labelThemeItem() {
  $('menu-theme').textContent = currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function toggleTheme() {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  labelThemeItem();
}

// The ⋯ menu: a menu button whose items are reachable with the arrow keys and close on Escape.
function initMenu() {
  const button = $('menu-button');
  const list = $('menu-list');
  const items = () => [...list.querySelectorAll('li:not([hidden]) > [role="menuitem"]')];
  const open = (focusIndex = 0) => {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    items().at(focusIndex)?.focus();
  };
  const close = (refocus = true) => {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  };
  button.addEventListener('click', () => (list.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowDown' ? 0 : -1);
    }
  });
  list.addEventListener('keydown', (e) => {
    const all = items();
    const i = all.indexOf(document.activeElement);
    const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      all.at(moves[e.key] % all.length)?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('click', (e) => {
    if (!$('edition-menu').contains(e.target)) close(false);
  });
  // The save item is a plain download link; the server names the file.
  $('menu-save').addEventListener('click', () => close());
  $('menu-print').addEventListener('click', () => {
    close();
    window.print();
  });
  $('menu-new').addEventListener('click', () => {
    close();
    newEdition();
  });
  $('menu-theme').addEventListener('click', () => {
    close();
    toggleTheme();
  });
  labelThemeItem();
  darkScheme.addEventListener('change', labelThemeItem);
}

$('assignment-form').addEventListener('submit', submitForm);
initViewer();
initMenu();

refresh();
setInterval(refresh, 1500);
