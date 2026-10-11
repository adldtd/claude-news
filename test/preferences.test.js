import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formDefaults, readPreferences, savePreferences } from '../src/preferences.js';
import { tempDir } from './helpers.js';

const scan = {
  root: '/repo/a',
  sources: [
    { id: 'git', available: true, defaultOn: true },
    { id: 'linear', available: true, defaultOn: true },
    { id: 'github-prs', available: false, defaultOn: false },
    { id: 'github-actions', available: true, defaultOn: false },
  ],
  styles: [{ id: 'broadsheet', default: true }, { id: 'tabloid' }],
};
const request = (ids, style = 'tabloid') => ({ sources: ids.map((id) => ({ id })), style: { id: style } });

test('with nothing saved the form uses the scan defaults', () => {
  assert.deepEqual(formDefaults(scan, {}), {
    sources: { git: true, linear: true, 'github-prs': false, 'github-actions': false },
    style: 'broadsheet',
    remembered: false,
  });
});

test('a deselected source stays deselected for that repo only', () => {
  const file = join(tempDir(), 'nested', 'preferences.json');
  savePreferences(scan, request(['git', 'github-actions']), file);
  const prefs = readPreferences(file);

  const here = formDefaults(scan, prefs);
  assert.equal(here.sources.linear, false);
  assert.equal(here.sources['github-actions'], true);
  assert.equal(here.style, 'tabloid');
  assert.equal(here.remembered, true);

  const other = formDefaults({ ...scan, root: '/repo/b' }, prefs);
  assert.equal(other.sources.linear, true);
  assert.equal(other.style, 'tabloid', 'a new repo starts with the last style used anywhere');
  assert.equal(other.remembered, false);
});

test('an unavailable source keeps its saved value until it is available again', () => {
  const file = join(tempDir(), 'preferences.json');
  writeFileSync(file, JSON.stringify({ repos: { '/repo/a': { sources: { 'github-prs': true } } } }));
  savePreferences(scan, request(['git']), file);
  const prefs = readPreferences(file);
  assert.equal(prefs.repos['/repo/a'].sources['github-prs'], true);
  assert.equal(formDefaults(scan, prefs).sources['github-prs'], false, 'shown off while unavailable');

  const online = { ...scan, sources: scan.sources.map((s) => (s.id === 'github-prs' ? { ...s, available: true } : s)) };
  assert.equal(formDefaults(online, prefs).sources['github-prs'], true);
});

test('a source the scan finds later starts at its own default', () => {
  const prefs = { repos: { '/repo/a': { sources: { git: true } } } };
  assert.equal(formDefaults(scan, prefs).sources.linear, true);
});

test('a saved style that no longer exists falls back to the default', () => {
  const prefs = { lastStyle: 'gone', repos: { '/repo/a': { style: 'gone' } } };
  assert.equal(formDefaults(scan, prefs).style, 'broadsheet');
});

test('a missing or corrupt file reads as empty', () => {
  const dir = tempDir();
  assert.deepEqual(readPreferences(join(dir, 'none.json')), {});
  writeFileSync(join(dir, 'bad.json'), '[1, 2');
  assert.deepEqual(readPreferences(join(dir, 'bad.json')), {});
  writeFileSync(join(dir, 'arr.json'), '[1, 2]');
  assert.deepEqual(readPreferences(join(dir, 'arr.json')), {});
  savePreferences(scan, request(['git']), join(dir, 'bad.json'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'bad.json'), 'utf8')).repos['/repo/a'].sources.git, true);
});
