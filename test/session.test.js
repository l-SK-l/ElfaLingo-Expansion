import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { ApiError } from '../extension/lib/api.js';
import { expiresAt, signIn, signOut, withAccess } from '../extension/lib/session.js';
import {
  API,
  errorEnvelope,
  healthy,
  installChrome,
  installServer,
  json,
  jwt,
  signedIn,
} from './helpers.js';

let stores;

beforeEach(() => {
  stores = installChrome();
});

const credentials = {
  server: 'elfa.example.com',
  email: 'me@example.com',
  password: 'correct horse',
  remember: true,
};

function loginOk() {
  return json(200, { access_token: jwt(900), token_type: 'bearer', refresh_token: 'refresh-1' });
}

test('sign-in finds the API, keeps the tokens and never the password', async () => {
  const calls = installServer({ 'GET /api/v1/health': healthy, 'POST /api/v1/auth/login': loginOk });

  await signIn(credentials);

  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ['GET /api/v1/health', 'POST /api/v1/auth/login'],
  );
  const login = calls[1];
  assert.deepEqual(login.body, { email: 'me@example.com', password: 'correct horse' });
  // Android-style sign-in: the refresh token in the body, no cookies either way.
  assert.equal(login.headers['X-Client'], undefined);
  assert.equal(login.init.credentials, 'omit');

  const auth = stores.local.get('auth');
  assert.equal(auth.apiBase, API);
  assert.equal(auth.refreshToken, 'refresh-1');
  assert.equal(stores.session.has('auth'), false);
  assert.deepEqual(stores.local.get('settings'), {
    server: 'elfa.example.com',
    email: 'me@example.com',
    remember: true,
  });

  const everything = JSON.stringify([...stores.local, ...stores.session]);
  assert.ok(!everything.includes('correct horse'));
});

test('without «Remember sign-in» the tokens live in session storage only', async () => {
  installServer({ 'GET /api/v1/health': healthy, 'POST /api/v1/auth/login': loginOk });

  await signIn({ ...credentials, remember: false });

  assert.equal(stores.local.has('auth'), false);
  assert.equal(stores.session.get('auth').refreshToken, 'refresh-1');
});

test('sign-in tries the app root when a path is not a subfolder', async () => {
  const calls = installServer({ 'GET /api/v1/health': healthy, 'POST /api/v1/auth/login': loginOk });

  await signIn({ ...credentials, server: 'https://elfa.example.com/cards' });

  assert.deepEqual(
    calls.map((c) => c.path),
    ['/cards/api/v1/health', '/api/v1/health', '/api/v1/auth/login'],
  );
  assert.equal(stores.local.get('auth').apiBase, API);
});

test('an address that answers with a web page is «not ElfaLingo»', async () => {
  installServer({
    'GET /api/v1/health': () => new Response('<html></html>', { status: 200 }),
  });
  await assert.rejects(signIn(credentials), { kind: 'foreign' });
  assert.equal(stores.local.has('auth'), false);
});

test('no answer at all is «unreachable», and so is a proxy whose origin is down', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(signIn(credentials), { kind: 'unreachable' });

  installServer({ 'GET /api/v1/health': () => new Response('origin down', { status: 530 }) });
  await assert.rejects(signIn(credentials), { kind: 'unreachable' });
});

test('wrong credentials come back as the server code', async () => {
  installServer({
    'GET /api/v1/health': healthy,
    'POST /api/v1/auth/login': () => errorEnvelope(401, 'invalid_credentials'),
  });
  await assert.rejects(signIn(credentials), { kind: 'http', code: 'invalid_credentials' });
  assert.equal(stores.local.has('auth'), false);
});

test('a token about to expire is refreshed before the call', async () => {
  await signedIn(stores, { access: jwt(10) });
  const fresh = jwt(900);
  const calls = installServer({
    'POST /api/v1/auth/refresh': () => json(200, { access_token: fresh, refresh_token: 'refresh-2' }),
  });

  const used = await withAccess(async (_, token) => token);

  assert.equal(used, fresh);
  assert.deepEqual(calls[0].body, { refresh_token: 'refresh-1' });
  assert.equal(stores.local.get('auth').refreshToken, 'refresh-2');
});

test('concurrent calls share one refresh — a second one would kill the session', async () => {
  await signedIn(stores, { access: jwt(-5) });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = installServer({
    'POST /api/v1/auth/refresh': async () => {
      await gate;
      return json(200, { access_token: jwt(900), refresh_token: 'refresh-2' });
    },
  });

  const results = Promise.all([1, 2, 3].map(() => withAccess(async (_, token) => token)));
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const tokens = await results;

  assert.equal(calls.filter((c) => c.path.endsWith('/auth/refresh')).length, 1);
  assert.equal(new Set(tokens).size, 1);
});

test('a 401 refreshes once and repeats the call', async () => {
  await signedIn(stores);
  const fresh = jwt(900);
  installServer({
    'POST /api/v1/auth/refresh': () => json(200, { access_token: fresh, refresh_token: 'refresh-2' }),
  });

  let attempts = 0;
  const result = await withAccess(async (_, token) => {
    attempts += 1;
    if (token !== fresh) {
      throw new ApiError('http', { status: 401, code: 'unauthorized' });
    }
    return 'done';
  });

  assert.equal(result, 'done');
  assert.equal(attempts, 2);
});

test('a refresh the server refuses ends the session', async () => {
  await signedIn(stores, { access: jwt(-5) });
  installServer({ 'POST /api/v1/auth/refresh': () => errorEnvelope(401, 'session_invalid') });

  await assert.rejects(
    withAccess(async () => 'never'),
    { kind: 'signed_out', code: 'session_invalid' },
  );
  assert.equal(stores.local.has('auth'), false);
});

test('a refresh that cannot reach the server keeps the session', async () => {
  await signedIn(stores, { access: jwt(-5) });
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(withAccess(async () => 'never'), { kind: 'unreachable' });
  assert.equal(stores.local.get('auth').refreshToken, 'refresh-1');
});

test('a disabled account ends the session', async () => {
  await signedIn(stores);
  await assert.rejects(
    withAccess(async () => {
      throw new ApiError('http', { status: 403, code: 'account_disabled' });
    }),
    { kind: 'signed_out', code: 'account_disabled' },
  );
  assert.equal(stores.local.has('auth'), false);
});

test('without a session nothing is sent', async () => {
  const calls = installServer({});
  await assert.rejects(withAccess(async () => 'never'), { kind: 'signed_out' });
  assert.equal(calls.length, 0);
});

test('sign-out forgets the session even when the server is gone', async () => {
  await signedIn(stores, { remember: false });
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  await signOut();

  assert.equal(stores.session.has('auth'), false);
  assert.equal(stores.local.has('auth'), false);
});

test('sign-out revokes the refresh token on the server', async () => {
  await signedIn(stores);
  const calls = installServer({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) });

  await signOut();

  assert.deepEqual(calls[0].body, { refresh_token: 'refresh-1' });
});

test('the expiry of an unreadable token is «now», so it gets refreshed', () => {
  assert.equal(expiresAt('not-a-jwt'), 0);
  assert.ok(expiresAt(jwt(60)) > Date.now());
});
