/**
 * The few ElfaLingo API calls the extension makes.
 *
 * Contract: ElfaLingo `docs/features/api-conventions.done.md` (error
 * envelope), `auth-users.done.md` and `tech-stack.done.md` §7 (tokens),
 * `word-intake.md` (`POST /cards`).
 *
 * The extension signs in the way the Android app does: no `X-Client: web`
 * header, so the refresh token comes back in the body instead of an httpOnly
 * cookie. Cookies are never sent (`credentials: 'omit'`): the web app's own
 * refresh cookie for the same server must not be picked up by
 * `/auth/refresh` or revoked by `/auth/logout` from here.
 */

const TIMEOUT_MS = 15_000;

// What a proxy answers with when the app behind it is down: nginx's 502–504,
// Cloudflare's 52x, and 530 when its tunnel has no origin to reach. For the
// user all of them mean the same as no answer at all.
const GATEWAY_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

/**
 * `kind` says who failed:
 * - `unreachable` — no answer, or a proxy saying the server is down;
 * - `foreign` — something answered, but it is not the ElfaLingo API
 *   (a wrong address, a captive portal, a web page instead of JSON);
 * - `http` — ElfaLingo answered with an error; `code` is the envelope's code,
 *   the only field the client branches on;
 * - `signed_out` — there is no usable session (raised by `session.js`).
 */
export class ApiError extends Error {
  constructor(kind, { status = 0, code = null, details = null } = {}) {
    super(code ? `${kind}: ${code}` : `${kind}${status ? ` (${status})` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function request(apiBase, path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(apiBase + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('unreachable');
  }

  if (GATEWAY_DOWN.has(response.status)) {
    throw new ApiError('unreachable', { status: response.status });
  }

  const data = await readJson(response);

  if (response.ok) {
    // 204 has no body; any other success without JSON is not our API.
    if (data === undefined && response.status !== 204) {
      throw new ApiError('foreign', { status: response.status });
    }
    return data ?? null;
  }

  const error = data?.error;
  if (!error || typeof error.code !== 'string') {
    throw new ApiError('foreign', { status: response.status });
  }
  throw new ApiError('http', {
    status: response.status,
    code: error.code,
    details: error.details ?? null,
  });
}

async function readJson(response) {
  const text = await response.text().catch(() => '');
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `/health` answers `{status, db}`; anything else is not ElfaLingo. */
export function isElfaLingoHealth(data) {
  return data?.status === 'ok' && typeof data.db === 'string';
}

export const api = {
  health: (apiBase) => request(apiBase, '/health'),

  login: (apiBase, email, password) =>
    request(apiBase, '/auth/login', { method: 'POST', body: { email, password } }),

  refresh: (apiBase, refreshToken) =>
    request(apiBase, '/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } }),

  logout: (apiBase, refreshToken) =>
    request(apiBase, '/auth/logout', { method: 'POST', body: { refresh_token: refreshToken } }),

  /**
   * `id` is generated here, not by the server: sending the same id again
   * returns the stored card instead of a second one, so a word whose answer
   * was lost can be resent safely (`backend/app/api/v1/cards.py`).
   */
  createCard: (apiBase, token, card) =>
    request(apiBase, '/cards', { method: 'POST', body: card, token }),
};
