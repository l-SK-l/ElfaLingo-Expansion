import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { MAX_SERVER_FAILURES, OUTBOX_LIMIT, enqueue, flush } from '../extension/lib/outbox.js';
import { errorEnvelope, installChrome, installServer, json, signedIn } from './helpers.js';

let stores;

beforeEach(async () => {
  stores = installChrome();
  await signedIn(stores);
});

function created({ body }) {
  return json(201, { id: body.id, lemma: body.lemma, status: 'queued' });
}

test('a queued word is sent with its own id, day offset and moment', async () => {
  const calls = installServer({ 'POST /api/v1/cards': created });
  const picked = new Date('2026-10-17T08:30:00Z');

  await enqueue(['Hund'], picked);
  const result = await flush();

  assert.deepEqual(result.added, ['Hund']);
  assert.equal(result.failure, null);
  assert.equal(result.pending, 0);

  const { body, headers } = calls[0];
  assert.equal(body.lemma, 'Hund');
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.equal(body.added_at, picked.toISOString());
  assert.equal(body.tz_offset_minutes, -picked.getTimezoneOffset());
  assert.match(headers.Authorization, /^Bearer /);
});

test('a word already in the deck is reported, not retried', async () => {
  installServer({
    'POST /api/v1/cards': () => errorEnvelope(409, 'card_duplicate', { card_id: 'x' }),
  });

  await enqueue(['Hund']);
  const result = await flush();

  assert.deepEqual(result.duplicates, ['Hund']);
  assert.equal(result.pending, 0);
});

test('a word the server refuses is dropped and reported', async () => {
  installServer({ 'POST /api/v1/cards': () => errorEnvelope(422, 'validation_error') });

  await enqueue(['???']);
  const result = await flush();

  assert.deepEqual(result.rejected, ['???']);
  assert.equal(result.pending, 0);
});

test('without a connection words wait, and go out later under the same ids', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await enqueue(['Hund', 'Katze']);

  const offline = await flush();
  assert.equal(offline.failure.kind, 'unreachable');
  assert.equal(offline.pending, 2);
  const queuedIds = stores.local.get('outbox').map((item) => item.id);

  const calls = installServer({ 'POST /api/v1/cards': created });
  const online = await flush();

  assert.deepEqual(online.added, ['Hund', 'Katze']);
  assert.equal(online.pending, 0);
  assert.deepEqual(
    calls.map((c) => c.body.id),
    queuedIds,
  );
});

test('the pass stops at the first connection failure and keeps the order', async () => {
  let sent = 0;
  installServer({
    'POST /api/v1/cards': (call) => {
      sent += 1;
      if (sent === 2) {
        return new Response('Bad gateway', { status: 502 });
      }
      return created(call);
    },
  });

  await enqueue(['eins', 'zwei', 'drei']);
  const result = await flush();

  assert.deepEqual(result.added, ['eins']);
  assert.equal(result.failure.kind, 'unreachable');
  assert.deepEqual(
    stores.local.get('outbox').map((item) => item.lemma),
    ['zwei', 'drei'],
  );
});

test('signed out, words wait for the sign-in', async () => {
  stores.local.delete('auth');
  const calls = installServer({});

  await enqueue(['Hund']);
  const result = await flush();

  assert.equal(result.failure.kind, 'signed_out');
  assert.equal(result.pending, 1);
  assert.equal(calls.length, 0);
});

test('a word the server keeps failing on is given up after a few tries', async () => {
  installServer({ 'POST /api/v1/cards': () => errorEnvelope(500, 'internal_error') });
  await enqueue(['kaputt']);

  for (let attempt = 1; attempt < MAX_SERVER_FAILURES; attempt += 1) {
    const result = await flush();
    assert.equal(result.failure.code, 'internal_error');
    assert.equal(result.pending, 1);
  }
  const last = await flush();
  assert.deepEqual(last.rejected, ['kaputt']);
  assert.equal(last.pending, 0);
});

test('a click during a running pass joins it, and every word is sent once', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = installServer({
    'POST /api/v1/cards': async (call) => {
      await gate;
      return created(call);
    },
  });

  await enqueue(['eins']);
  const first = flush();
  await enqueue(['zwei']);
  const second = flush();
  release();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.deepEqual(a.added, ['eins', 'zwei']);
  assert.deepEqual(
    calls.map((c) => c.body.lemma),
    ['eins', 'zwei'],
  );
});

test('the outbox has a ceiling, and what does not fit is returned', async () => {
  const words = Array.from({ length: OUTBOX_LIMIT + 3 }, (_, i) => `Wort${i}`);
  const overflow = await enqueue(words);
  assert.equal(overflow.length, 3);
  assert.equal(stores.local.get('outbox').length, OUTBOX_LIMIT);
});
