/**
 * Where the extension keeps what it knows.
 *
 * - `settings` (local): the server address as typed, the email and the
 *   «Remember sign-in» choice. Prefills the form; no secrets.
 * - `auth` (local or session): the API base and both tokens. With «Remember
 *   sign-in» it lives in `storage.local` until the user signs out; without it
 *   in `storage.session`, which Chrome keeps in memory and drops when the
 *   browser closes. The password is never stored anywhere — it is exchanged
 *   for tokens and forgotten.
 * - `outbox` (local): words waiting to be sent, see `outbox.js`.
 * - `status` (local): what the toolbar icon shows, so the options page and a
 *   restarted service worker see the same state.
 */

const local = () => chrome.storage.local;
const session = () => chrome.storage.session;

export async function getSettings() {
  const { settings } = await local().get('settings');
  return settings ?? null;
}

export async function saveSettings(settings) {
  await local().set({ settings });
}

export async function getAuth() {
  const fromSession = await session().get('auth');
  if (fromSession.auth) {
    return fromSession.auth;
  }
  const fromLocal = await local().get('auth');
  return fromLocal.auth ?? null;
}

export async function saveAuth(auth) {
  const [keep, drop] = auth.remember ? [local(), session()] : [session(), local()];
  await keep.set({ auth });
  await drop.remove('auth');
}

export async function clearAuth() {
  await Promise.all([local().remove('auth'), session().remove('auth')]);
}

export async function getOutbox() {
  const { outbox } = await local().get('outbox');
  return outbox ?? [];
}

export async function saveOutbox(outbox) {
  await local().set({ outbox });
}

export async function getStatus() {
  const { status } = await local().get('status');
  return status ?? null;
}

export async function saveStatus(status) {
  await local().set({ status });
}
