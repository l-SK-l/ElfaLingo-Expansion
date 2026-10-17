// Runs a task with Playwright's Chromium in a given UI language.
//
// chrome.i18n follows the browser's UI language, not the page's locale.
// Linux and Windows take it from --lang; macOS ignores the flag and reads
// AppleLanguages. Passing that on the command line needs an argument without
// a dash, which Chromium opens as a URL (and headless refuses a second one),
// so on macOS the preference is set in the test browser's own domain —
// Chrome for Testing, not the user's Chrome — and put back afterwards.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { chromium } from 'playwright';

/** Launch arguments for the language; use inside `inUiLanguage`. */
export function languageArgs(locale) {
  return [`--lang=${locale}`];
}

export async function inUiLanguage(locale, task) {
  if (process.platform !== 'darwin') {
    return task();
  }
  const plist = path.resolve(chromium.executablePath(), '../../Info.plist');
  const domain = execFileSync('defaults', ['read', plist, 'CFBundleIdentifier'], {
    encoding: 'utf8',
  }).trim();
  const defaults = (...args) => execFileSync('defaults', args, { stdio: 'pipe' });

  let saved = null;
  try {
    defaults('read', domain, 'AppleLanguages');
    saved = defaults('export', domain, '-');
  } catch {
    saved = null;
  }

  defaults('write', domain, 'AppleLanguages', '-array', locale);
  try {
    return await task();
  } finally {
    if (saved) {
      execFileSync('defaults', ['import', domain, '-'], { input: saved });
    } else {
      defaults('delete', domain, 'AppleLanguages');
    }
  }
}
