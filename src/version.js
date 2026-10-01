import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PACKAGE_ROOT } from './scan.js';

const CODE_DIRS = ['bin', 'src', 'web'];

function filesUnder(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

// A hash of the code the server runs, so `serve` can tell a server started from older code.
export function codeVersion(root = PACKAGE_ROOT) {
  const hash = createHash('sha1');
  const files = CODE_DIRS.flatMap((d) => filesUnder(join(root, d))).sort();
  for (const file of files) {
    hash.update(relative(root, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
