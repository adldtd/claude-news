import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function tempDir(prefix = 'cn-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeRepo({ email = 'me@example.com', name = 'Me', commits = [], remote, files = {} } = {}) {
  const dir = tempDir();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', email);
  git('config', 'user.name', name);
  git('config', 'commit.gpgsign', 'false');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  if (Object.keys(files).length) git('add', '-A');
  for (const c of commits) {
    const env = { ...process.env, GIT_AUTHOR_DATE: c.date, GIT_COMMITTER_DATE: c.date, GIT_AUTHOR_EMAIL: c.email ?? email, GIT_AUTHOR_NAME: c.name ?? name, GIT_COMMITTER_EMAIL: c.email ?? email, GIT_COMMITTER_NAME: c.name ?? name };
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', c.message], { cwd: dir, env });
  }
  if (remote) git('remote', 'add', 'origin', remote);
  return dir;
}
