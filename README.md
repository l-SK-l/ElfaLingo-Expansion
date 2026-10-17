# ElfaLingo: Add to Deck — Chrome extension

Select a word on any website → right-click → “Add “…” to ElfaLingo” — and
the word goes to the new-word queue, just as if it were typed in the “+”
dialog.

The extension needs nothing from the server: it talks to the same `/api/v1`
API as the app and signs in the way the Android client does (refresh token
in the response body, no cookies).

## Installing for development

1. `chrome://extensions` → turn on “Developer mode”.
2. “Load unpacked” → the `extension/` folder.
3. The settings page opens: server address, email, password,
   “Remember sign-in”.

The server address is where the ElfaLingo API answers. In production that is
the site's own address (`https://elfalingo.example.com`): Caddy serves the
web app and proxies `/api/*` to the backend on the same origin. In
development the two are apart — the web app runs on the Flutter dev server
(`:8080`), which answers every path with its `index.html` — so enter the
backend's address instead: `http://localhost:8000`, with the `http://`
(without a scheme the extension assumes `https://`).

On sign-in Chrome asks for access to that server — one host, not every
site. The access is given up on sign-out.

## How it works

- **Selection.** Punctuation and quotes at the edges are cut, line breaks
  become spaces, soft hyphens and invisible characters from web pages are
  removed, NFC is applied. Commas split a list — each word is cleaned and
  sent separately. Brackets that belong to the word stay: `(sich) freuen`,
  `freuen (über)`. An entry longer than 100 characters (the server's column)
  and a selection longer than 1000 characters are not sent.
- **Outbox.** A word is first written to the `outbox`, then sent to
  `POST /cards` with its own `id`. No connection or an expired session — the
  word waits and goes out on its own: on the next add, on the check every
  5 minutes, after sign-in. A retry with the same `id` does not create a
  second card.
- **Session.** The password is stored nowhere. With “Remember sign-in” the
  tokens live in `chrome.storage.local` until sign-out; without it, in
  `chrome.storage.session` until the browser closes. The access token is
  refreshed by a single request shared by all callers: the server rotates
  the refresh token and, when an old one is presented again, revokes the
  whole session family — so two concurrent rotations must never happen.
- **Icon.**

  | Icon | Meaning |
  |---|---|
  | ✓ / +3 (green, for 4 s) | the word (three words) sent |
  | = (brown, for 4 s) | the deck already has this word |
  | × (red, for 4 s) | not added: the selection is not a word |
  | ! (amber) | sign-in needed — clicking the icon opens the settings |
  | ! (red) on a grey cat | no connection to the server |
  | ! (red) | the server returned an error / the address does not lead to ElfaLingo |

  The hover tooltip says the same in words, plus how many words are waiting
  to be sent and what happened last time.

## Structure

```
extension/            ← what goes to the store
  manifest.json       the version lives here only
  background.js       service worker: menu, outbox, icon, messages
  lib/text.js         parsing the selection (a port of lemma_list.dart)
  lib/server.js       server address → candidate API base URLs
  lib/api.js          API calls and the error envelope
  lib/session.js      sign-in/out, token refresh as a single request
  lib/outbox.js       the queue of words to send
  lib/badge.js        the icon and its tooltip
  lib/store.js        what is stored where
  options/            the settings page
  _locales/en, ru     every UI string
assets/brand/         icon sources — files from web/ of the main repository
scripts/              icons, packaging, version, e2e, store images, test browser language
store/                privacy policy, store texts and images
test/                 unit tests (node:test, no dependencies)
```

## Build

```bash
./build-dist.sh           # tests → checks → build into dist/
./build-dist.sh patch     # raise the version first: 1.0.0 → 1.0.1 (minor, major)
./build-dist.sh 1.2.0     # set the version explicitly (lower than current is refused — the store would reject it)
```

`dist/` then holds, side by side:

- `elfalingo-extension-<version>.zip` — upload this to the Chrome Web Store;
- `elfalingo-extension-<version>/` — the same files unpacked:
  `chrome://extensions` → “Developer mode” → “Load unpacked” → this folder.
  The archive is packed from it, so what you try in the browser is exactly
  what goes to the store.

The version is shown on the settings page under the name. Packaging checks
what the store rejects on: MV3, the version format, that the files exist,
the name (75) and description (132) length in every locale, the same set of
keys in every locale, that every string the code asks for is defined, and
that there is no remote code.

## Tests

```bash
npm test                  # unit tests: selection parsing, address, session, outbox
npm install               # once: Playwright for e2e and store images
E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
E2E_LANGS=en npm run e2e  # …in one language only (default: en,ru)
```

e2e loads the extension into a real Chromium and runs it against a live
server (`E2E_SERVER`, default `http://localhost:8000` — `make backend` in
the main repository), end to end in each UI language: sign-in with a wrong
password and with an unreachable server, sign-in without remembering,
adding, a duplicate, a selection without a word, a lost connection and the
outbox catching up, sign-out. Every text — the page, the icon tooltip, the
menu item, the errors — is checked against `_locales/<lang>/messages.json`,
and the English page must not contain a single Cyrillic letter. Chrome's
context menu is native and cannot be clicked from automation, so the test
calls the same handler the menu does (`globalThis.elfalingo.addSelection` in
the service worker). In each language the test creates two “E2E Prüfwort …”
cards in the account and deletes them at the end, and makes one sign-in
attempt with a wrong password (the lockout comes after three).

## Interface language

The extension speaks the language of Chrome's interface, not of the site:
a Russian Chrome gets the Russian interface, any other — English. The
language cannot be chosen in the extension itself; that is how `chrome.i18n`
works. To see the English version on a Mac: System Settings → General →
Language & Region → Applications → Google Chrome → English, then restart
Chrome. On Windows and Linux: Settings → Languages → “Display Google Chrome
in this language”.

The test Chromium (e2e, store images) gets its language the same way: on
macOS `--lang` is ignored, so `scripts/ui-language.mjs` sets `AppleLanguages`
for Chrome for Testing — not for your Chrome — for the duration of the run
and restores it afterwards.

## Icons and store images

```bash
npm run icons             # extension/icons/ from assets/brand/ (needs Pillow)
npm run store-images      # store/*.png: promo tile and en/ru screenshots
```

## Publishing

Step by step, with ready-made texts for every field of the form —
`store/LISTING.md`.
