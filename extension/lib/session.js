/**
 * Signing in and out, and calling the API with a fresh access token.
 *
 * The access token lives 15 minutes, the refresh token 30 days from last use
 * (ElfaLingo `tech-stack.done.md` §7). Every refresh rotates the refresh
 * token, and presenting an already used one is treated as theft: the server
 * revokes the whole family and every client has to sign in again. So two
 * refreshes must never race — all of them go through one promise, and only
 * the service worker refreshes (the options page asks it by message).
 */

import { ApiError, api, isElfaLingoHealth } from './api.js';
import { parseServerUrl } from './server.js';
import * as store from './store.js';

// Refresh a little before expiry rather than spend a request on a 401.
const EXPIRY_MARGIN_MS = 60_000;

let refreshing = null;

/**
 * Finds the API behind `server`, signs in and stores the session.
 * Throws `SettingsError` for an unusable address and `ApiError` otherwise.
 */
export async function signIn({ server, email, password, remember }) {
  const { candidates } = parseServerUrl(server);
  const apiBase = await findApi(candidates);

  let tokens;
  try {
    tokens = await api.login(apiBase, email, password);
  } catch (error) {
    // The address answered /health a moment ago, so a 404 here means a
    // different app under the same path, not a typo in the credentials.
    if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
      throw new ApiError('foreign', { status: 404 });
    }
    throw error;
  }
  if (!tokens?.access_token || !tokens?.refresh_token) {
    throw new ApiError('foreign');
  }

  await store.saveSettings({ server: server.trim(), email, remember });
  await store.saveAuth({
    apiBase,
    email,
    remember,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });
}

/** Forgets the session here first, then tells the server — best effort. */
export async function signOut() {
  const auth = await store.getAuth();
  await store.clearAuth();
  if (auth) {
    await api.logout(auth.apiBase, auth.refreshToken).catch(() => {});
  }
}

/**
 * Calls `call(apiBase, accessToken)`, refreshing the token first if it is
 * about to expire and once more on a 401. A session the server refuses to
 * renew is dropped, and the caller gets `ApiError('signed_out')`.
 */
export async function withAccess(call) {
  let auth = await store.getAuth();
  if (!auth) {
    throw new ApiError('signed_out');
  }
  if (expiresAt(auth.accessToken) - Date.now() < EXPIRY_MARGIN_MS) {
    auth = await refresh(auth);
  }

  try {
    return await call(auth.apiBase, auth.accessToken);
  } catch (error) {
    if (isHttp(error, 403) && error.code === 'account_disabled') {
      await store.clearAuth();
      throw new ApiError('signed_out', { status: 403, code: error.code });
    }
    if (!isHttp(error, 401)) {
      throw error;
    }
  }

  auth = await refresh(auth);
  try {
    return await call(auth.apiBase, auth.accessToken);
  } catch (error) {
    // Rejected right after a successful refresh: the session is not ours to fix.
    if (isHttp(error, 401) || isHttp(error, 403)) {
      await store.clearAuth();
      throw new ApiError('signed_out', { status: error.status, code: error.code });
    }
    throw error;
  }
}

function refresh(stale) {
  refreshing ??= renew(stale).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function renew(stale) {
  const current = await store.getAuth();
  if (!current) {
    throw new ApiError('signed_out');
  }
  // Someone refreshed between the caller's read and now.
  if (
    current.accessToken !== stale.accessToken &&
    expiresAt(current.accessToken) - Date.now() >= EXPIRY_MARGIN_MS
  ) {
    return current;
  }

  let tokens;
  try {
    tokens = await api.refresh(current.apiBase, current.refreshToken);
  } catch (error) {
    if (isHttp(error, 401) || isHttp(error, 403)) {
      await store.clearAuth();
      throw new ApiError('signed_out', { status: error.status, code: error.code });
    }
    throw error;
  }

  const next = {
    ...current,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? current.refreshToken,
  };
  await store.saveAuth(next);
  return next;
}

/**
 * The first candidate that answers like ElfaLingo's `/health`. «No
 * connection» and «this is not ElfaLingo» need different fixes from the user,
 * so they stay different errors. The candidates share one origin: if the
 * first one cannot be reached, neither can the rest.
 */
async function findApi(candidates) {
  for (const apiBase of candidates) {
    try {
      if (isElfaLingoHealth(await api.health(apiBase))) {
        return apiBase;
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.kind === 'unreachable') {
        throw error;
      }
    }
  }
  throw new ApiError('foreign');
}

/** Expiry of a JWT in ms, or 0 when it cannot be read — then it is refreshed. */
export function expiresAt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function isHttp(error, status) {
  return error instanceof ApiError && error.kind === 'http' && error.status === status;
}
