/**
 * The service worker: the context menu, the outbox, the toolbar icon and the
 * only code that holds the session. The options page talks to it by message.
 */

import { ApiError, api, isElfaLingoHealth } from './lib/api.js';
import * as badge from './lib/badge.js';
import * as outbox from './lib/outbox.js';
import { SettingsError } from './lib/server.js';
import { signIn, signOut } from './lib/session.js';
import * as store from './lib/store.js';
import { parseSelection } from './lib/text.js';

const MENU_ID = 'elfalingo-add';

// Keeps the icon honest about the connection and sends words that waited
// for it. `/health` needs no session, so a check does not rotate tokens.
const CHECK_ALARM = 'elfalingo-check';
const CHECK_PERIOD_MINUTES = 5;

// Error codes the options page has its own text for; any other `http` error
// is shown as a generic server error.
const KNOWN_HTTP_CODES = new Set([
  'invalid_credentials',
  'account_disabled',
  'too_many_attempts',
  'validation_error',
]);

// Listeners are registered synchronously at the top level: a worker woken by
// an event only receives it if the listener exists by the end of startup.

chrome.runtime.onInstalled.addListener(({ reason }) =>
  guard(async () => {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage('menuAdd'),
      contexts: ['selection'],
    });
    await ensureAlarm();
    if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
      await chrome.runtime.openOptionsPage();
    }
    await check();
  }),
);

chrome.runtime.onStartup.addListener(() =>
  guard(async () => {
    await ensureAlarm();
    await check();
  }),
);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) {
    guard(() => addSelection(info.selectionText ?? ''));
  }
});

chrome.action.onClicked.addListener(() => guard(() => chrome.runtime.openOptionsPage()));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) {
    guard(check);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own pages: there are no content scripts, and web pages cannot
  // reach this listener without `externally_connectable` anyway.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    return false;
  }
  const handler = HANDLERS[message?.type];
  if (!handler) {
    return false;
  }
  handler(message).then(
    (value) => sendResponse({ ok: true, ...value }),
    (error) => sendResponse({ ok: false, error: errorCode(error) }),
  );
  return true;
});

const HANDLERS = {
  state: () => state(),

  signIn: async ({ server, email, password, remember }) => {
    await signIn({ server, email, password, remember: Boolean(remember) });
    // Sends the words picked while signed out, and clears the amber «!».
    await check();
    return state();
  },

  signOut: async () => {
    await signOut();
    // Queued words belong to the account that is leaving: signing in as
    // someone else must not drop them into a stranger's deck.
    await outbox.clear();
    await update({ problem: 'signed_out', last: null });
    return state();
  },

  check: async () => {
    await check();
    return state();
  },
};

async function addSelection(text) {
  const { lemmas, rejected } = parseSelection(text);
  const overflow = lemmas.length ? await outbox.enqueue(lemmas) : [];
  const refused = [...rejected, ...overflow];

  if (!(await store.getAuth())) {
    // The word waits in the outbox and goes out right after sign-in, as on
    // Android, where a word shared before signing in is offered after it.
    await update({ problem: 'signed_out' });
    await chrome.runtime.openOptionsPage();
    return;
  }

  if (!lemmas.length) {
    await report({ added: [], duplicates: [], rejected: refused, failure: null, empty: true });
    return;
  }

  await badge.sending();
  const result = await outbox.flush();
  result.rejected.unshift(...refused);
  await report(result);
}

/** Is the server there? If it is, sends whatever is waiting. */
async function check() {
  const auth = await store.getAuth();
  if (!auth) {
    await update({ problem: 'signed_out' });
    return;
  }

  try {
    const health = await api.health(auth.apiBase);
    if (!isElfaLingoHealth(health)) {
      throw new ApiError('foreign');
    }
    if (health.db !== 'ok') {
      // The app answers but cannot reach its database: nothing would save.
      throw new ApiError('http', { status: 503, code: 'db_down' });
    }
  } catch (error) {
    await update({ problem: problemOf(error) });
    return;
  }

  if ((await store.getOutbox()).length) {
    await badge.sending();
  }
  await report(await outbox.flush());
}

/** Records the outcome of a send and shows it on the icon. */
async function report(result) {
  const words = result.added.length + result.duplicates.length + result.rejected.length;
  const patch = { problem: result.failure ? problemOf(result.failure) : null };
  if (words || result.empty) {
    patch.last = {
      at: new Date().toISOString(),
      added: result.added,
      duplicates: result.duplicates,
      rejected: result.rejected,
      empty: Boolean(result.empty),
    };
  }
  await update(patch, { flash: Boolean(patch.last) });
}

async function update(patch, { flash = false } = {}) {
  const status = {
    problem: null,
    last: null,
    ...(await store.getStatus()),
    ...patch,
    pending: (await store.getOutbox()).length,
  };
  await store.saveStatus(status);
  await (flash ? badge.flash(status) : badge.render(status));
  return status;
}

function problemOf(error) {
  if (!(error instanceof ApiError)) {
    return 'server_error';
  }
  switch (error.kind) {
    case 'unreachable':
      return 'unreachable';
    case 'foreign':
      return 'foreign';
    case 'signed_out':
      return error.code === 'account_disabled' ? 'account_disabled' : 'signed_out';
    default:
      return 'server_error';
  }
}

function errorCode(error) {
  if (error instanceof SettingsError) {
    return error.code;
  }
  if (error instanceof ApiError) {
    if (error.kind !== 'http') {
      return error.kind;
    }
    return KNOWN_HTTP_CODES.has(error.code) ? error.code : 'server_error';
  }
  console.error(error);
  return 'unknown';
}

async function state() {
  const [settings, auth, status] = await Promise.all([
    store.getSettings(),
    store.getAuth(),
    store.getStatus(),
  ]);
  return {
    settings,
    account: auth && { email: auth.email, apiBase: auth.apiBase, remember: auth.remember },
    status,
  };
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(CHECK_ALARM))) {
    await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
  }
}

/** An event handler must not die silently: log, and say so on the icon. */
async function guard(task) {
  try {
    await task();
  } catch (error) {
    console.error(error);
    await update({ problem: problemOf(error) }).catch(() => {});
  }
}

// A handle for the service worker's DevTools console and the end-to-end
// test, which cannot click Chrome's native context menu. Web pages have no
// way to reach a worker's global scope.
globalThis.elfalingo = { addSelection, check };
