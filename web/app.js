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

async function newEdition() {
  if (!confirm('Start a new edition? The current one will be cleared from this page.')) return;
  await fetch('/api/reset', { method: 'POST' });
  resetNews();
  try { history.replaceState(null, '', location.pathname); } catch {}
  await refresh();
}

$('assignment-form').addEventListener('submit', submitForm);
initViewer();
$('new-edition').addEventListener('click', newEdition);

refresh();
setInterval(refresh, 1500);
