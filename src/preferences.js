import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJson, writeJson } from './state.js';
import { DEFAULT_MAX_WORDS, WORDS_RANGE } from './limits.js';

// The form choices a user keeps between editions. Unlike the state dir (under tmpdir, gone on
// reboot) this lives in the user's config dir. Sources are kept per repo, as on/off per id, so a
// source the scan finds later still starts at its own default.
export function preferencesPath() {
  if (process.env.CLAUDE_NEWS_CONFIG_DIR) return join(process.env.CLAUDE_NEWS_CONFIG_DIR, 'preferences.json');
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'claude-news', 'preferences.json');
}

export function readPreferences(file = preferencesPath()) {
  const prefs = readJson(file, {});
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

// What the form should start with for this repo: each source checked or not, the style and the word
// limit. The story target is not kept: it depends on the date range, so it always starts at the suggestion.
export function formDefaults(scan, prefs) {
  const saved = prefs.repos?.[scan.root] ?? {};
  const known = (id) => scan.styles.some((s) => s.id === id);
  const fallback = scan.styles.find((s) => s.default)?.id ?? scan.styles[0]?.id ?? null;
  const style = [saved.style, prefs.lastStyle].find(known) ?? fallback;
  const sources = Object.fromEntries(
    scan.sources.map((s) => [s.id, s.available && (typeof saved.sources?.[s.id] === 'boolean' ? saved.sources[s.id] : s.defaultOn)]),
  );
  const inRange = (n) => Number.isInteger(n) && n >= WORDS_RANGE.min && n <= WORDS_RANGE.max;
  const maxWords = [saved.maxWords, prefs.lastMaxWords].find(inRange) ?? DEFAULT_MAX_WORDS;
  return { sources, style, maxWords };
}

// Records what the user sent to press. Sources that were unavailable keep their saved value, so
// one comes back ticked once (say) gh is logged in again.
export function savePreferences(scan, request, file = preferencesPath()) {
  const prefs = readPreferences(file);
  const repos = prefs.repos && typeof prefs.repos === 'object' ? prefs.repos : {};
  const previous = repos[scan.root] ?? {};
  const chosen = new Set(request.sources.map((s) => s.id));
  const sources = { ...previous.sources };
  for (const s of scan.sources) if (s.available) sources[s.id] = chosen.has(s.id);
  const style = request.style?.id;
  const maxWords = request.limits?.maxWords;
  const next = {
    ...prefs,
    ...(style ? { lastStyle: style } : {}),
    ...(maxWords ? { lastMaxWords: maxWords } : {}),
    repos: { ...repos, [scan.root]: { ...previous, sources, ...(style ? { style } : {}), ...(maxWords ? { maxWords } : {}) } },
  };
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, next);
  return next;
}
