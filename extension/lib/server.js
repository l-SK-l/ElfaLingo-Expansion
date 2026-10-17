/**
 * Turns what the user typed into the «Server address» field into API base
 * URLs to try.
 *
 * People paste whatever their address bar shows: a bare domain, the web
 * app's URL with a route after `#`, or the API URL itself. All of these
 * should work, because the user knows the address of the site, not where its
 * API is mounted.
 */

// ElfaLingo's default `api_base_path` (`backend/app/core/config.py`); the
// production web image serves the API on the same origin under it.
export const API_PATH = '/api/v1';

const API_PATH_PATTERN = /\/api\/v\d+$/;

export class SettingsError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SettingsError';
    this.code = code;
  }
}

/**
 * Returns the server's origin, the host pattern to ask permission for and the
 * API base URLs to probe, most likely first.
 *
 * A path that already ends in `/api/vN` is taken as the API. Any other path
 * may be a subfolder the app is deployed under (`/elfa` → `/elfa/api/v1`) or a
 * route of the web app (`/cards`), and nothing in the URL tells which, so both
 * are tried.
 */
export function parseServerUrl(input) {
  const raw = (input ?? '').trim();
  if (!raw) {
    throw new SettingsError('server_required');
  }

  // Without a scheme `new URL` fails or, worse, reads `host:8080` as a scheme.
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new SettingsError('invalid_url');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new SettingsError('invalid_url');
  }

  const path = url.pathname.replace(/\/+$/, '');
  const candidates = API_PATH_PATTERN.test(path)
    ? [url.origin + path]
    : [...new Set([url.origin + path + API_PATH, url.origin + API_PATH])];

  return {
    origin: url.origin,
    // Match patterns ignore the port, so one pattern covers `localhost:8000`.
    hostPattern: `${url.protocol}//${url.hostname}/*`,
    candidates,
    insecure: url.protocol === 'http:' && !isLoopback(url.hostname),
  };
}

function isLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}
