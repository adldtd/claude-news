import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STYLES_DIR = join(PACKAGE_ROOT, 'styles');

const NOT_TICKETS = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'SSL', 'ES', 'CVE', 'GPT', 'X', 'AES', 'RSA', 'WCAG', 'PEP']);
const DAY_MS = 24 * 60 * 60 * 1000;

function run(cmd, args, cwd, timeout = 15000) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), missing: r.error?.code === 'ENOENT' };
}

function git(args, cwd) {
  return run('git', args, cwd);
}

export function parseRemote(url) {
  if (!url) return null;
  const m = url.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)[:/](.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const [, host, path] = m;
  return { host, path, webUrl: `https://${host}/${path}` };
}

export function ticketPrefixes(messages, branches = []) {
  const counts = new Map();
  const texts = [...messages.map((t) => [t, false]), ...branches.map((t) => [t, true])];
  for (const [text, allowLower] of texts) {
    for (const m of text.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})\b/g)) {
      const prefix = m[1].toUpperCase();
      if (NOT_TICKETS.has(prefix) || /^\d+$/.test(prefix)) continue;
      if (m[1] !== prefix && !(allowLower && /^[a-z]+$/.test(m[1]))) continue;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

function repoMentions(root, pattern) {
  return git(['grep', '-I', '-l', '-i', '-E', pattern], root).out.split('\n').filter(Boolean);
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  return meta;
}

export function listStyles() {
  if (!existsSync(STYLES_DIR)) return [];
  return readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const meta = parseFrontmatter(readFileSync(join(STYLES_DIR, f), 'utf8'));
      const id = f.replace(/\.md$/, '');
      return { id, label: meta.label || id, description: meta.description || '', path: join(STYLES_DIR, f), default: meta.default === 'true' };
    });
}

export function scan(repoPath = process.cwd(), { now = new Date() } = {}) {
  const version = run('git', ['--version'], repoPath);
  if (version.missing || !version.ok) {
    return { ok: false, reason: 'git is not installed or not on PATH.' };
  }
  const top = git(['rev-parse', '--show-toplevel'], repoPath);
  if (!top.ok) {
    return { ok: false, reason: `${repoPath} is not inside a git repository.` };
  }
  const root = top.out;
  const head = git(['log', '-1', '--format=%H'], root);
  if (!head.ok || !head.out) {
    return { ok: false, reason: `${root} has no commit history this user can read.`, root };
  }

  const userEmail = git(['config', 'user.email'], root).out;
  const userName = git(['config', 'user.name'], root).out;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).out;

  let lastUserCommit = null;
  for (const who of [userEmail, userName].filter(Boolean)) {
    const r = git(['log', '--all', '-1', '--fixed-strings', `--author=${who}`, '--format=%H%x09%cI%x09%s'], root);
    if (r.ok && r.out) {
      const [hash, date, subject] = r.out.split('\t');
      lastUserCommit = { hash, date, subject };
      break;
    }
  }

  const until = now.toISOString();
  const since = lastUserCommit ? new Date(lastUserCommit.date).toISOString() : new Date(now.getTime() - DAY_MS).toISOString();
  const sinceReason = lastUserCommit ? 'your last commit' : 'no commits by you found, so the last 24 hours';

  const remoteNames = git(['remote'], root).out.split('\n').filter(Boolean);
  const remoteName = remoteNames.includes('origin') ? 'origin' : remoteNames[0];
  const remote = remoteName ? parseRemote(git(['remote', 'get-url', remoteName], root).out) : null;
  const isGitHub = remote?.host === 'github.com';
  const isGitLab = remote?.host?.includes('gitlab');

  const sources = [];
  const add = (id, label, available, detail, defaultOn = available) => sources.push({ id, label, available, detail, defaultOn: available && defaultOn });

  const commitCount = git(['rev-list', '--count', 'HEAD'], root).out;
  add('git', 'Git commits', true, `${commitCount} commits on ${branch}`);

  if (isGitHub) {
    const gh = run('gh', ['auth', 'status'], root);
    const ghOk = gh.ok;
    const why = gh.missing ? 'gh CLI is not installed' : ghOk ? `${remote.path} via gh` : 'gh is not authenticated (run gh auth login)';
    add('github-prs', 'GitHub pull requests', ghOk, why);
    add('github-issues', 'GitHub issues', ghOk, why);
    const hasWorkflows = existsSync(join(root, '.github', 'workflows'));
    add('github-actions', 'GitHub Actions runs', ghOk && hasWorkflows, hasWorkflows ? why : 'no .github/workflows in the repo', false);
  }
  if (isGitLab) {
    const glab = run('glab', ['auth', 'status'], root);
    add('gitlab', 'GitLab merge requests', glab.ok, glab.missing ? 'glab CLI is not installed' : glab.ok ? `${remote.path} via glab` : 'glab is not authenticated');
  }

  const subjects = git(['log', '-300', '--format=%s%n%b'], root).out.split('\n');
  const branches = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], root).out.split('\n');
  const prefixes = ticketPrefixes(subjects, branches);
  const keyNote = prefixes.length ? `ticket keys ${prefixes.slice(0, 3).map((p) => `${p}-…`).join(', ')} in commits/branches` : '';
  const trackers = [
    { id: 'linear', label: 'Linear issues', name: 'Linear', strong: 'linear\\.app/', weak: '\\blinear\\b' },
    { id: 'jira', label: 'Jira issues', name: 'Jira', strong: 'atlassian\\.net|jira\\.[a-z0-9.-]+/browse', weak: '\\bjira\\b' },
  ].map((t) => ({ ...t, strongFiles: repoMentions(root, t.strong), weakFiles: repoMentions(root, t.weak) }));
  const detected = trackers.filter((t) => t.strongFiles.length > 0 || t.weakFiles.length >= 3);
  for (const t of detected) {
    const where = t.strongFiles[0] ?? t.weakFiles[0];
    add(t.id, t.label, true, [keyNote, `referenced in ${where}`].filter(Boolean).join('; ') + ` (needs a ${t.name} MCP/tool in the agent session)`);
  }
  if (prefixes.length && !detected.length) {
    add('tickets', 'Issue tracker tickets', true, `${keyNote}; tracker unknown (needs a matching MCP/tool)`);
  }

  const changelogs = readdirSync(root).filter((f) => /^(CHANGELOG|CHANGES|HISTORY|RELEASES)/i.test(f));
  if (changelogs.length) add('changelog', 'Changelog', true, changelogs.join(', '));
  if (existsSync(join(root, 'docs'))) add('docs', 'Docs changes', true, 'files under docs/');

  const contextFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'docs/README.md', 'docs/glossary.md']
    .filter((f) => existsSync(join(root, f)));

  return {
    ok: true,
    root,
    name: basename(root),
    branch,
    remote,
    user: { name: userName, email: userEmail },
    lastUserCommit,
    defaults: { since, until, sinceReason },
    sources,
    ticketPrefixes: prefixes,
    contextFiles,
    styles: listStyles(),
  };
}
