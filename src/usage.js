import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SESSION_ID = /^[0-9a-f-]{8,64}$/i;

export function projectsDir(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

// Claude Code writes one transcript per session at <projects>/<encoded cwd>/<session>.jsonl,
// with subagent transcripts under <projects>/<encoded cwd>/<session>/subagents/.
export function findTranscripts(sessionId, root = projectsDir()) {
  if (!sessionId || !SESSION_ID.test(sessionId) || !existsSync(root)) return [];
  for (const project of readdirSync(root)) {
    const main = join(root, project, `${sessionId}.jsonl`);
    if (!existsSync(main)) continue;
    const subDir = join(root, project, sessionId, 'subagents');
    const subs = existsSync(subDir) ? readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(subDir, f)) : [];
    return [main, ...subs];
  }
  return [];
}

const EMPTY = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

export function totalOf(u) {
  return u.input + u.cacheWrite + u.cacheRead + u.output;
}

// Sums usage of assistant messages at or after `since`. A message streamed as several content
// blocks is logged once per block with the same id, so each id counts once (its last record wins).
export function sumUsage(files, since) {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const byId = new Map();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = rec.message;
      if (rec.type !== 'assistant' || !msg?.usage) continue;
      if (sinceMs && !(new Date(rec.timestamp).getTime() >= sinceMs)) continue;
      byId.set(msg.id ?? `${file}:${rec.uuid}`, msg.usage);
    }
  }
  const sum = { ...EMPTY };
  for (const u of byId.values()) {
    sum.input += u.input_tokens ?? 0;
    sum.cacheWrite += u.cache_creation_input_tokens ?? 0;
    sum.cacheRead += u.cache_read_input_tokens ?? 0;
    sum.output += u.output_tokens ?? 0;
  }
  return { ...sum, total: totalOf(sum), messages: byId.size };
}

// Re-reads the transcripts only when one of them has grown, so polling the site stays cheap.
export function usageTracker(sessionId, since, root) {
  let files = [];
  let key = null;
  let last = null;
  return () => {
    files = findTranscripts(sessionId, root);
    if (!files.length) return null;
    const nextKey = files.map((f) => {
      try {
        return `${f}:${statSync(f).size}`;
      } catch {
        return f;
      }
    }).join('|');
    if (nextKey !== key) {
      key = nextKey;
      last = sumUsage(files, since);
    }
    return last;
  };
}
