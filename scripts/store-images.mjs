// Renders the Chrome Web Store images into store/:
//   promo-440x280-<lang>.png       the small promo tile (required by the store)
//   screenshot-1280x800-<lang>.png the real settings page with sample data
//   icon-128.png                   the store icon (the extension's own)
//
//   npm run store-images
//
// The settings page is the extension itself, loaded into Chromium; only its
// storage is filled with a sample account, so no server is needed.

import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { inUiLanguage, languageArgs } from './ui-language.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const STORE = path.join(ROOT, 'store');

const TEXT = {
  ru: {
    locale: 'ru-RU',
    tagline: 'Слова в колоду<br>с любого сайта',
    menu: 'Добавить «Hund» в ElfaLingo',
  },
  en: {
    locale: 'en-US',
    tagline: 'Words for your deck<br>from any website',
    menu: 'Add “Hund” to ElfaLingo',
  },
};

const badge = `data:image/png;base64,${(await readFile(path.join(ROOT, 'assets/brand/badge-512.png'))).toString('base64')}`;

function promoHtml({ tagline, menu }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
    body {
      background: radial-gradient(circle at 30% 40%, #76370b, #672b05 70%);
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: #fff8f5; display: flex; align-items: center; gap: 22px; padding: 0 30px;
      box-sizing: border-box;
    }
    img { width: 132px; height: 132px; flex: none; filter: drop-shadow(0 6px 14px rgba(0,0,0,.35)); }
    h1 { margin: 0 0 6px; font-size: 34px; letter-spacing: -0.5px; }
    p { margin: 0 0 16px; font-size: 18px; line-height: 1.3; color: #f6e3d7; }
    .menu {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px;
      background: #fff8f5; color: #221a15; border-radius: 8px; font-size: 12.5px;
      box-shadow: 0 4px 12px rgba(0,0,0,.3); white-space: nowrap;
    }
    .menu i { width: 16px; height: 16px; background: url(${badge}) center/cover; border-radius: 4px; }
  </style></head><body>
    <img src="${badge}" alt="">
    <div><h1>ElfaLingo</h1><p>${tagline}</p><span class="menu"><i></i>${menu}</span></div>
  </body></html>`;
}

const SAMPLE = {
  settings: { server: 'https://elfalingo.example.com', email: 'anna@example.com', remember: true },
  auth: {
    apiBase: 'https://elfalingo.example.com/api/v1',
    email: 'anna@example.com',
    remember: true,
    accessToken: 'sample',
    refreshToken: 'sample',
  },
  status: {
    problem: null,
    pending: 0,
    last: {
      at: new Date().toISOString(),
      added: ['die Gelegenheit'],
      duplicates: [],
      rejected: [],
      empty: false,
    },
  },
};

for (const [lang, text] of Object.entries(TEXT)) {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 440, height: 280 } });
  await page.setContent(promoHtml(text));
  await page.screenshot({ path: path.join(STORE, `promo-440x280-${lang}.png`) });
  await browser.close();

  await inUiLanguage(text.locale, async () => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      locale: text.locale,
      viewport: { width: 1280, height: 800 },
      colorScheme: 'light',
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        ...languageArgs(text.locale),
      ],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    // Let the install handler finish (it records «signed out»), then put the
    // sample account in place of it.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await worker.evaluate(async (sample) => {
      await chrome.alarms.clearAll();
      await chrome.storage.local.set(sample);
    }, SAMPLE);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options/options.html`);
    await options.waitForSelector('#account:not([hidden])');
    await options.screenshot({ path: path.join(STORE, `screenshot-1280x800-${lang}.png`) });
    await context.close();
  });
}

await copyFile(path.join(EXT, 'icons/icon-128.png'), path.join(STORE, 'icon-128.png'));
console.log('✔ store/ images rendered');
