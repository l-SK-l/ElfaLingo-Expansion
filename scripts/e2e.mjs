// End-to-end check: the extension loaded into a real Chromium, talking to a
// running ElfaLingo server, once per interface language.
//
//   E2E_SERVER=http://localhost:8000 E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
//   E2E_LANGS=en npm run e2e        only one language (default: en,ru)
//
// Chrome's native context menu cannot be clicked from automation, so the
// test calls the same handler the menu calls (`globalThis.elfalingo` in the
// service worker). Everything else — the options page, the permission, the
// API, the icon — is the real thing. Every text is checked against
// `_locales/<lang>/messages.json`, so a string left untranslated or a browser
// that ignored the language fails the run.
//
// Each language creates two cards in the account and deletes them at the end,
// and makes one wrong-password attempt — the server locks sign-in after three,
// and a successful sign-in resets the count.

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { inUiLanguage, languageArgs } from './ui-language.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = process.env.E2E_SERVER ?? 'http://localhost:8000';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const LANGS = (process.env.E2E_LANGS ?? 'en,ru').split(',').map((lang) => lang.trim());
const LOCALES = { en: 'en-US', ru: 'ru-RU' };

if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD (an account on E2E_SERVER).');
  process.exit(2);
}

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✔' : '✘'} ${name}${condition || !detail ? '' : ` — ${detail}`}`);
  if (!condition) {
    failures += 1;
  }
}

const until = async (probe, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value || Date.now() > deadline) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** `chrome.i18n.getMessage` over a locale's file, placeholders included. */
async function messagesFor(lang) {
  const table = JSON.parse(
    await readFile(path.join(ROOT, 'extension/_locales', lang, 'messages.json'), 'utf8'),
  );
  return (key, substitutions = []) => {
    let text = table[key].message;
    for (const [name, { content }] of Object.entries(table[key].placeholders ?? {})) {
      const value = content.replace(/\$(\d)/g, (_, i) => substitutions[i - 1] ?? '');
      text = text.replace(new RegExp(`\\$${name}\\$`, 'gi'), value);
    }
    return text;
  };
}

for (const lang of LANGS) {
  console.log(`\n── ${lang} ──`);
  await inUiLanguage(LOCALES[lang], () => run(lang));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

async function run(lang) {
  const msg = await messagesFor(lang);

  // The permission prompt is a native dialog too. The copy under test gets
  // the server's host as a required permission, so `permissions.request`
  // resolves at once, exactly as it does after the user clicks «Allow».
  const work = await mkdtemp(path.join(tmpdir(), 'elfalingo-e2e-'));
  const extensionDir = path.join(work, 'extension');
  await cp(path.join(ROOT, 'extension'), extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const server = new URL(SERVER);
  manifest.host_permissions = [`${server.protocol}//${server.hostname}/*`];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    channel: 'chromium',
    headless: !process.env.HEADED,
    locale: LOCALES[lang],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      ...languageArgs(LOCALES[lang]),
    ],
  });

  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const created = new Set();
  let cleanup = null;

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = new URL(worker.url()).host;
    const badgeText = () => worker.evaluate(() => chrome.action.getBadgeText({}));
    const title = () => worker.evaluate(() => chrome.action.getTitle({}));
    const storage = (area, key) =>
      worker.evaluate(([a, k]) => chrome.storage[a].get(k).then((r) => r[k] ?? null), [area, key]);

    // The language Chrome runs the extension in.
    const uiLanguage = await worker.evaluate(() => chrome.i18n.getUILanguage());
    check(`the browser runs in ${lang}`, uiLanguage.startsWith(lang), uiLanguage);
    check(
      'the context menu item is in this language',
      (await worker.evaluate(() => chrome.i18n.getMessage('menuAdd'))) === msg('menuAdd'),
    );

    // Installing opens the settings.
    const optionsUrl = `chrome-extension://${extensionId}/options/options.html`;
    const options =
      (await until(() => context.pages().find((p) => p.url().startsWith(optionsUrl)))) ??
      (await context.newPage());
    if (!options.url().startsWith(optionsUrl)) {
      await options.goto(optionsUrl);
    }
    check('installing opens the settings page', options.url().startsWith(optionsUrl));
    await options.waitForSelector('#signin:not([hidden])');

    check('the page title and heading are translated', (await options.title()) === msg('pageTitle') && (await options.textContent('h1')) === msg('extName'));
    check('the version is shown', (await options.textContent('#version')) === msg('versionLabel', [manifest.version]));
    const pageText = await options.evaluate(() => document.body.innerText);
    if (lang === 'en') {
      check('no Russian is left on the English page', !/[А-Яа-яЁё]/.test(pageText), pageText.match(/.*[А-Яа-яЁё].*/)?.[0]);
    } else {
      check('the page is in Russian', pageText.includes(msg('signInTitle')) && pageText.includes(msg('legendTitle')));
    }

    check('before sign-in the icon asks for it', (await until(async () => (await badgeText()) === '!')) === true);
    check('…and the tooltip says why', (await title()).includes(msg('problem_signed_out')));

    // A wrong password is named as such.
    await options.fill('#server', SERVER);
    await options.fill('#email', EMAIL);
    await options.fill('#password', `${PASSWORD}-wrong`);
    await options.click('#signin-button');
    await options.waitForSelector('#signin-error:not([hidden])');
    check('a wrong password is reported', (await options.textContent('#signin-error')) === msg('error_invalid_credentials'));

    // A server that is not there.
    await options.fill('#server', 'http://localhost:9');
    await options.fill('#password', PASSWORD);
    await options.click('#signin-button');
    const unreachable = msg('error_unreachable');
    await options.waitForFunction((text) => document.querySelector('#signin-error')?.textContent === text, unreachable);
    check('an unreachable server is reported', true);

    // The real sign-in, not remembered.
    await options.fill('#server', SERVER);
    await options.fill('#password', PASSWORD);
    await options.uncheck('#remember');
    await options.click('#signin-button');
    await options.waitForSelector('#account:not([hidden])');
    check('sign-in shows the account', (await options.textContent('#account-email')) === EMAIL);
    check('…and the session is «until the browser closes»', (await options.textContent('#account-session')) === msg('sessionBrowser'));
    check('the session is kept in memory only', (await storage('session', 'auth')) !== null && (await storage('local', 'auth')) === null);
    const everything = JSON.stringify([
      await worker.evaluate(() => chrome.storage.local.get(null)),
      await worker.evaluate(() => chrome.storage.session.get(null)),
    ]);
    check('the password is stored nowhere', !everything.includes(PASSWORD));
    check('the icon is quiet when signed in', (await until(async () => (await badgeText()) === '')) === true);
    await options.waitForFunction((text) => document.querySelector('#status-text')?.textContent === text, msg('statusOk'));
    check('the settings page says it is connected', true);

    const auth = await storage('session', 'auth');
    cleanup = { apiBase: auth.apiBase, token: auth.accessToken };
    const word = `E2E Prüfwort ${lang} ${Date.now()}`;
    const add = (text) => worker.evaluate((t) => globalThis.elfalingo.addSelection(t), text);

    // Sending a word.
    await add(`  „${word}“, `);
    check('a sent word shows ✓', (await badgeText()) === '✓', await badgeText());
    check('the tooltip names the word', (await title()).includes(msg('resultAdded', [msg('quoted', [word])])));

    // The same word again.
    await add(word.toLowerCase());
    check('a word already in the deck shows =', (await badgeText()) === '=', await badgeText());
    check('…and the tooltip says so', (await title()).includes(msg('resultDuplicate', [msg('quoted', [word.toLowerCase()])])));

    // A selection without a word.
    await add(' — … ');
    check('a selection without a word shows ×', (await badgeText()) === '×', await badgeText());
    check('…and the tooltip says so', (await title()).includes(msg('resultNothing')));

    // The server goes away.
    await worker.evaluate(
      (a) => chrome.storage.session.set({ auth: { ...a, apiBase: 'http://localhost:9/api/v1' } }),
      auth,
    );
    const offlineWord = `${word} offline`;
    await add(offlineWord);
    check('no connection shows !', (await badgeText()) === '!', await badgeText());
    const offlineStatus = await storage('local', 'status');
    check('the word waits in the outbox', offlineStatus.pending === 1 && offlineStatus.problem === 'unreachable');
    check('the tooltip says there is no connection', (await title()).includes(msg('problem_unreachable')));
    check('…and how many words wait', (await title()).includes(msg('titlePending', ['1'])));
    await options.waitForFunction((text) => document.querySelector('#status-text')?.textContent === text, msg('problem_unreachable'));
    check('the settings page shows it too', true);

    // The server is back: the next check sends the word.
    const current = await storage('session', 'auth');
    await worker.evaluate((a) => chrome.storage.session.set({ auth: a }), { ...current, apiBase: auth.apiBase });
    await worker.evaluate(() => globalThis.elfalingo.check());
    const backStatus = await storage('local', 'status');
    check('the waiting word goes out once the server is back', backStatus.pending === 0 && backStatus.problem === null && backStatus.last.added.includes(offlineWord));
    check('…and the icon says so', (await badgeText()) === '✓');
    cleanup.token = (await storage('session', 'auth')).accessToken;

    // What the server has now.
    const response = await fetch(`${auth.apiBase}/cards?limit=200&updated_since=${encodeURIComponent(startedAt)}`, {
      headers: { Authorization: `Bearer ${cleanup.token}` },
    });
    const cards = (await response.json()).items.filter((card) => card.lemma.startsWith(`E2E Prüfwort ${lang}`));
    for (const card of cards) {
      created.add(card.id);
    }
    const lemmas = cards.map((card) => card.lemma).sort();
    check('the server has exactly the two words, cleaned', JSON.stringify(lemmas) === JSON.stringify([word, offlineWord].sort()), JSON.stringify(lemmas));

    // Sign-out.
    await options.click('#signout-button');
    await options.waitForSelector('#signin:not([hidden])');
    check('sign-out forgets the session', (await storage('session', 'auth')) === null && (await storage('local', 'auth')) === null);
    check('…and the icon asks to sign in again', (await badgeText()) === '!');
    check('the form keeps the server and email', (await options.inputValue('#server')) === SERVER && (await options.inputValue('#email')) === EMAIL);
  } finally {
    // The access token outlives the sign-out by its 15 minutes, which is
    // enough to delete what the run created.
    for (const id of created) {
      const deleted = await fetch(`${cleanup.apiBase}/cards/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cleanup.token}` },
      });
      check(`test card ${id.slice(0, 8)} deleted`, deleted.status === 204, String(deleted.status));
    }
    await context.close();
    await rm(work, { recursive: true, force: true });
  }
}
