// Stand-ins for the parts of Chrome and the ElfaLingo server the modules use.

export function installChrome() {
  const local = new Map();
  const session = new Map();
  const area = (map) => ({
    async get(keys) {
      const out = {};
      for (const key of [].concat(keys)) {
        if (map.has(key)) {
          out[key] = structuredClone(map.get(key));
        }
      }
      return out;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        map.set(key, structuredClone(value));
      }
    },
    async remove(keys) {
      for (const key of [].concat(keys)) {
        map.delete(key);
      }
    },
  });

  globalThis.chrome = {
    storage: { local: area(local), session: area(session) },
    i18n: {
      getMessage: (key, substitutions) =>
        substitutions ? `${key}(${[].concat(substitutions).join('|')})` : key,
    },
  };
  return { local, session };
}

/**
 * Routes `fetch` to handlers keyed by `METHOD /path`. Each handler gets the
 * parsed body and headers and returns a Response (or throws, like a dead
 * network does). Unknown routes answer 404 the way FastAPI does.
 */
export function installServer(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = { method, path: pathname, body, headers: init.headers ?? {}, init };
    calls.push(call);
    const handler = handlers[`${method} ${pathname}`];
    if (!handler) {
      return json(404, { error: { code: 'not_found', message: 'Not Found', details: null } });
    }
    return handler(call);
  };
  return calls;
}

export function json(status, data) {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorEnvelope(status, code, details = null) {
  return json(status, { error: { code, message: code, details } });
}

/** A JWT the client can read the expiry of; the signature is never checked here. */
export function jwt(expiresInSeconds, salt = Math.random().toString(36).slice(2)) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = Buffer.from(JSON.stringify({ sub: 'user', exp, salt })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

export const API = 'https://elfa.example.com/api/v1';

export function healthy() {
  return json(200, { status: 'ok', db: 'ok' });
}

export async function signedIn(stores, { access = jwt(900), refresh = 'refresh-1', remember = true } = {}) {
  const auth = { apiBase: API, email: 'me@example.com', remember, accessToken: access, refreshToken: refresh };
  (remember ? stores.local : stores.session).set('auth', auth);
  return auth;
}
