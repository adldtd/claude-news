import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, repoKey, writeJson } from './state.js';

// What a full scan learns about how a repo works (its trackers, ticket keys and context files), plus
// the notes Claude writes after reading those files. Later scans reuse it and only look at the new
// activity. It lives in the user's cache dir, not the state dir under tmpdir, so a reboot keeps it.
// Bump the version when the full scan starts finding something new, so old caches are redone.
export const KNOWLEDGE_VERSION = 1;
// The full scan reads the last 300 commits for ticket keys; past that many new ones, redo it.
export const MAX_NEW_COMMITS = 300;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NOTES_CHARS = 20000;

export function knowledgeDir(root) {
  const base = process.env.CLAUDE_NEWS_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'claude-news');
  return join(base, repoKey(root));
}

const knowledgePath = (root) => join(knowledgeDir(root), 'knowledge.json');
const notesPath = (root) => join(knowledgeDir(root), 'notes.md');

export function hashFiles(root, files) {
  return Object.fromEntries(files.map((f) => [f, createHash('sha1').update(readFileSync(join(root, f))).digest('hex').slice(0, 12)]));
}

export function loadKnowledge(root) {
  const k = readJson(knowledgePath(root));
  return k && typeof k === 'object' && !Array.isArray(k) ? k : null;
}

// A cache that can't be written (say, a read-only home) only means the next scan is a full one.
export function saveKnowledge(root, knowledge) {
  try {
    mkdirSync(knowledgeDir(root), { recursive: true });
    writeJson(knowledgePath(root), knowledge);
  } catch {}
}

const sameHashes = (a = {}, b = {}) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

// Why the cached knowledge can't be reused, or null if it can. `commitsSince` is how many commits
// HEAD has that the cached HEAD doesn't, or null when git can't tell (the old HEAD is gone).
export function staleReason(cached, { contextHashes, commitsSince }, now = new Date()) {
  if (!cached) return 'no earlier scan';
  if (cached.version !== KNOWLEDGE_VERSION) return 'claude-news changed what a full scan finds';
  if (!sameHashes(cached.contextHashes, contextHashes)) return 'the context files changed';
  if (commitsSince === null) return 'the last full scan was of a commit that is gone';
  if (commitsSince > MAX_NEW_COMMITS) return `${commitsSince} new commits since the last full scan`;
  if (now.getTime() - new Date(cached.scannedAt).getTime() > MAX_AGE_MS) return 'the last full scan is over 30 days old';
  return null;
}

// Notes count as fresh only if they were written against the current full scan: a new full scan
// means the context files or the repo moved on, so Claude should read them again.
export function notesStatus(root, knowledge = loadKnowledge(root)) {
  const path = notesPath(root);
  if (!existsSync(path)) return null;
  return { path, fresh: Boolean(knowledge?.id && knowledge.notes?.basedOn === knowledge.id), writtenAt: knowledge?.notes?.writtenAt ?? null };
}

export function saveNotes(root, text, now = new Date()) {
  const knowledge = loadKnowledge(root);
  if (!knowledge) return { ok: false, reason: 'no full scan is cached for this repo; run `claude-news scan` first.' };
  const notes = String(text).trim();
  if (!notes) return { ok: false, reason: 'the notes file is empty' };
  if (notes.length > MAX_NOTES_CHARS) return { ok: false, reason: `the notes are ${notes.length} characters; keep them under ${MAX_NOTES_CHARS}` };
  mkdirSync(knowledgeDir(root), { recursive: true });
  writeFileSync(notesPath(root), notes + '\n');
  saveKnowledge(root, { ...knowledge, notes: { writtenAt: now.toISOString(), basedOn: knowledge.id } });
  return { ok: true, ...notesStatus(root) };
}
