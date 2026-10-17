// Sets the extension's version in extension/manifest.json — the only place
// it is kept; the settings page and the package name read it from there.
//
//   node scripts/version.mjs 1.2.0
//   node scripts/version.mjs patch|minor|major
//
// The Chrome Web Store refuses an upload whose version is not higher than the
// published one, so going down is refused here too.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension/manifest.json');

const arg = process.argv[2];
const text = readFileSync(MANIFEST, 'utf8');
const current = JSON.parse(text).version;
const parts = current.split('.').map(Number);
while (parts.length < 3) {
  parts.push(0);
}

let next;
switch (arg) {
  case 'major':
    next = `${parts[0] + 1}.0.0`;
    break;
  case 'minor':
    next = `${parts[0]}.${parts[1] + 1}.0`;
    break;
  case 'patch':
    next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    break;
  default:
    next = arg;
}

// Chrome: one to four dot-separated integers, each 0–65535, no leading zeros.
const valid =
  /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(next ?? '') &&
  next.split('.').every((n) => Number(n) <= 65535);
if (!valid) {
  console.error(`✘ "${arg}" is not a version: use patch, minor, major or e.g. 1.2.0`);
  process.exit(1);
}

if (compare(next, current) < 0) {
  console.error(`✘ ${next} is lower than the current ${current}; the store would refuse it`);
  process.exit(1);
}

// Replaced in place, so the rest of the file keeps its formatting.
writeFileSync(MANIFEST, text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`));
console.log(`▸ version ${current} → ${next}`);

function compare(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 4; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) {
      return diff;
    }
  }
  return 0;
}
