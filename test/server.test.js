import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseServerUrl } from '../extension/lib/server.js';

test('a bare domain becomes https with the default API path', () => {
  assert.deepEqual(parseServerUrl(' elfa.example.com '), {
    origin: 'https://elfa.example.com',
    hostPattern: 'https://elfa.example.com/*',
    candidates: ['https://elfa.example.com/api/v1'],
    insecure: false,
  });
});

test('the web app URL with a route after # works', () => {
  assert.deepEqual(parseServerUrl('https://elfa.example.com/#/cards').candidates, [
    'https://elfa.example.com/api/v1',
  ]);
});

test('an API URL is taken as it is', () => {
  assert.deepEqual(parseServerUrl('https://elfa.example.com/api/v1/').candidates, [
    'https://elfa.example.com/api/v1',
  ]);
  assert.deepEqual(parseServerUrl('https://host/sub/api/v2').candidates, ['https://host/sub/api/v2']);
});

test('another path is tried as a subfolder first, then as a route of the app', () => {
  assert.deepEqual(parseServerUrl('https://host/elfa/').candidates, [
    'https://host/elfa/api/v1',
    'https://host/api/v1',
  ]);
});

test('the host pattern ignores the port, as match patterns do', () => {
  const parsed = parseServerUrl('http://localhost:8000');
  assert.equal(parsed.hostPattern, 'http://localhost/*');
  assert.deepEqual(parsed.candidates, ['http://localhost:8000/api/v1']);
});

test('plain http is flagged unless the server is this computer', () => {
  assert.equal(parseServerUrl('http://localhost:8000').insecure, false);
  assert.equal(parseServerUrl('http://127.0.0.1:8000').insecure, false);
  assert.equal(parseServerUrl('http://192.168.1.10:8081').insecure, true);
  assert.equal(parseServerUrl('http://elfa.example.com').insecure, true);
});

test('unusable input is refused with a code the page can show', () => {
  assert.throws(() => parseServerUrl('   '), { code: 'server_required' });
  assert.throws(() => parseServerUrl('ftp://elfa.example.com'), { code: 'invalid_url' });
  assert.throws(() => parseServerUrl('https://user:secret@elfa.example.com'), { code: 'invalid_url' });
  assert.throws(() => parseServerUrl('https://exa mple.com'), { code: 'invalid_url' });
});
