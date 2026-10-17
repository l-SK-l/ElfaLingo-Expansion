/**
 * The settings page: the server address, the account and «Remember sign-in»
 * — nothing else (that is the whole of what the extension is configured by).
 *
 * The page holds no session of its own. Signing in, out and checking the
 * connection are asked of the service worker, the only place tokens are
 * refreshed (see `lib/session.js` for why there must be only one).
 */

import { describeLast } from '../lib/badge.js';
import { parseServerUrl, SettingsError } from '../lib/server.js';

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
const $ = (id) => document.getElementById(id);

const form = $('signin-form');
const serverInput = $('server');
const emailInput = $('email');
const passwordInput = $('password');
const rememberInput = $('remember');

// The form is filled from the saved settings once per signed-out view, so
// a live status update does not overwrite what the user is typing.
let formFilled = false;

localize();
refresh();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.status || changes.outbox)) {
    refresh();
  }
});

serverInput.addEventListener('input', showInsecureWarning);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(null);

  let target;
  try {
    target = parseServerUrl(serverInput.value);
  } catch (error) {
    showError(error instanceof SettingsError ? error.code : 'unknown');
    return;
  }

  // Must be the first await of the handler: Chrome shows the permission
  // prompt only while the click's user activation lasts. The extension asks
  // for this one server and nothing else.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [target.hostPattern] });
  } catch {
    granted = false;
  }
  if (!granted) {
    showError('permission_denied');
    return;
  }

  setBusy(true, 'buttonSigningIn');
  try {
    const response = await send({
      type: 'signIn',
      server: serverInput.value,
      email: emailInput.value.trim(),
      password: passwordInput.value,
      remember: rememberInput.checked,
    });
    if (!response.ok) {
      showError(response.error);
      return;
    }
    passwordInput.value = '';
    await keepOnlyOrigin(target.hostPattern);
    render(response);
  } finally {
    setBusy(false, 'buttonSignIn');
  }
});

$('check-button').addEventListener('click', async () => {
  const button = $('check-button');
  button.disabled = true;
  showStatusLine(t('statusChecking'), '');
  try {
    render(await send({ type: 'check' }));
  } finally {
    button.disabled = false;
  }
});

$('signout-button').addEventListener('click', async () => {
  $('signout-button').disabled = true;
  try {
    const response = await send({ type: 'signOut' });
    // Access to the server is given up with the session: the extension does
    // not keep a host permission it has no use for.
    await keepOnlyOrigin(null);
    formFilled = false;
    render(response);
  } finally {
    $('signout-button').disabled = false;
  }
});

async function refresh() {
  render(await send({ type: 'state' }));
}

async function send(message) {
  try {
    return (await chrome.runtime.sendMessage(message)) ?? { ok: false, error: 'unknown' };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}

function render(state) {
  if (!state?.ok) {
    return;
  }
  const { settings, account, status } = state;

  $('signin').hidden = Boolean(account);
  $('account').hidden = !account;

  if (account) {
    formFilled = false;
    $('account-server').textContent = account.apiBase.replace(/\/api\/v\d+$/, '');
    $('account-email').textContent = account.email;
    $('account-session').textContent = t(account.remember ? 'sessionRemembered' : 'sessionBrowser');
  } else if (!formFilled) {
    formFilled = true;
    serverInput.value = settings?.server ?? '';
    emailInput.value = settings?.email ?? '';
    rememberInput.checked = settings?.remember ?? true;
    showInsecureWarning();
  }

  renderStatus(status, Boolean(account));
}

function renderStatus(status, signedIn) {
  const pending = status?.pending ?? 0;
  const lastLines = describeLast(status?.last);

  // Signed out, the form says it all; the card only appears for words that
  // are waiting for the sign-in.
  if (!signedIn) {
    $('status').hidden = pending === 0;
    showStatusLine(t('titlePending', [String(pending)]), 'amber');
    $('status-pending').hidden = true;
    $('status-last').hidden = true;
    return;
  }

  $('status').hidden = false;
  const problem = status?.problem;
  if (problem) {
    showStatusLine(t(`problem_${problem}`), 'problem');
  } else {
    showStatusLine(t('statusOk'), 'ok');
  }

  $('status-pending').hidden = pending === 0;
  $('status-pending').textContent = t('titlePending', [String(pending)]);

  $('status-last').hidden = lastLines.length === 0;
  $('status-last-lines').replaceChildren(
    ...lastLines.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }),
  );
}

function showStatusLine(text, tone) {
  $('status-text').textContent = text;
  $('status-dot').className = `dot ${tone}`;
}

function showInsecureWarning() {
  let insecure = false;
  try {
    insecure = parseServerUrl(serverInput.value).insecure;
  } catch {
    insecure = false;
  }
  $('insecure').hidden = !insecure;
}

function showError(code) {
  const box = $('signin-error');
  box.hidden = !code;
  box.textContent = code ? t(`error_${code}`) || t('error_unknown') : '';
}

function setBusy(busy, labelKey) {
  const button = $('signin-button');
  button.disabled = busy;
  button.textContent = t(labelKey);
  for (const input of form.querySelectorAll('input')) {
    input.disabled = busy;
  }
}

/** Gives up host access to every server but `pattern` (all of them for null). */
async function keepOnlyOrigin(pattern) {
  const { origins = [] } = await chrome.permissions.getAll();
  const unused = origins.filter((origin) => origin !== pattern);
  if (unused.length) {
    await chrome.permissions.remove({ origins: unused }).catch(() => {});
  }
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = t('pageTitle');
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  // From the manifest, the one place the version is kept (build-dist.sh sets it).
  $('version').textContent = t('versionLabel', [chrome.runtime.getManifest().version]);
}
