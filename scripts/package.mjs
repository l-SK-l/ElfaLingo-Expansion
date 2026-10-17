// Checks the extension against the Chrome Web Store's hard limits and builds
// two things side by side in dist/:
//   elfalingo-extension-<version>.zip  the file to upload to the store
//   elfalingo-extension-<version>/     the same files unpacked, for
//                                      chrome://extensions → «Load unpacked»
// The archive is packed from that folder, so what is tried in the browser
// is exactly what goes to the store.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const problems = [];

const manifest = JSON.parse(readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const locales = readdirSync(path.join(EXT, '_locales'));
const messages = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(path.join(EXT, '_locales', locale, 'messages.json'), 'utf8')),
  ]),
);

if (manifest.manifest_version !== 3) {
  problems.push('manifest_version must be 3');
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  problems.push(`version "${manifest.version}" is not 1–4 dot-separated integers`);
}
if (!messages[manifest.default_locale]) {
  problems.push(`default_locale "${manifest.default_locale}" has no messages.json`);
}

for (const file of [
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  manifest.background.service_worker,
  manifest.options_ui.page,
  'icons/icon-16-off.png',
  'icons/icon-32-off.png',
]) {
  if (!existsSync(path.join(EXT, file))) {
    problems.push(`missing file: ${file}`);
  }
}

// Every locale carries every key, and the store's length limits hold in each.
const reference = Object.keys(messages[manifest.default_locale] ?? {}).sort();
for (const [locale, table] of Object.entries(messages)) {
  const keys = Object.keys(table).sort();
  const missing = reference.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !reference.includes(key));
  if (missing.length || extra.length) {
    problems.push(`${locale}: missing [${missing}] extra [${extra}]`);
  }
  if ((table.extName?.message ?? '').length > 75) {
    problems.push(`${locale}: extName is longer than 75 characters`);
  }
  if ((table.extDescription?.message ?? '').length > 132) {
    problems.push(`${locale}: extDescription is longer than 132 characters`);
  }
}

// Every key the code asks for exists. Keys built at run time
// (`problem_${…}`, `error_${…}`) are checked by prefix against the codes.
const sources = ['background.js', 'lib/badge.js', 'options/options.js', 'options/options.html']
  .map((file) => readFileSync(path.join(EXT, file), 'utf8'))
  .join('\n');
const used = new Set(
  [...sources.matchAll(/(?:\bt\(|getMessage\(|data-i18n=)['"]([A-Za-z_]+)['"]/g)].map((m) => m[1]),
);
for (const code of ['signed_out', 'account_disabled', 'unreachable', 'foreign', 'server_error']) {
  used.add(`problem_${code}`);
}
for (const code of [
  'server_required',
  'invalid_url',
  'permission_denied',
  'unreachable',
  'foreign',
  'invalid_credentials',
  'account_disabled',
  'too_many_attempts',
  'validation_error',
  'server_error',
  'signed_out',
  'unknown',
]) {
  used.add(`error_${code}`);
}
for (const key of used) {
  if (!reference.includes(key)) {
    problems.push(`message "${key}" is used but not defined`);
  }
}

// No remote code: the store rejects anything that loads script from outside.
if (/https?:\/\/[^"'\s]+\.js\b|\beval\(|new Function\(/.test(sources)) {
  problems.push('remote or dynamic code found in the sources');
}

if (problems.length) {
  console.error(problems.map((p) => `✘ ${p}`).join('\n'));
  process.exit(1);
}

const dist = path.join(ROOT, 'dist');
const name = `elfalingo-extension-${manifest.version}`;
const folder = path.join(dist, name);
const zip = path.join(dist, `${name}.zip`);

mkdirSync(dist, { recursive: true });
rmSync(folder, { recursive: true, force: true });
rmSync(zip, { force: true });

cpSync(EXT, folder, {
  recursive: true,
  filter: (source) => path.basename(source) !== '.DS_Store',
});
execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: folder });

console.log(`✔ ${path.relative(ROOT, folder)}/`);
console.log(`✔ ${path.relative(ROOT, zip)}`);
