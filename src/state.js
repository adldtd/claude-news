import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function stateDir(repoRoot) {
  const hash = createHash('sha1').update(repoRoot).digest('hex').slice(0, 12);
  const dir = join(process.env.CLAUDE_NEWS_STATE_ROOT || join(tmpdir(), 'claude-news'), hash);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export function serverInfoPath(dir) {
  return join(dir, 'server.json');
}

export function readServerInfo(dir) {
  return readJson(serverInfoPath(dir));
}

export function clearServerInfo(dir) {
  const file = serverInfoPath(dir);
  if (existsSync(file)) rmSync(file);
}
