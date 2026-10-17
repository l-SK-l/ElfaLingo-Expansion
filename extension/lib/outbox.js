/**
 * Words on their way to the server.
 *
 * A word picked from the menu is written here before anything is sent, and
 * leaves only when the server has answered for it. A dropped connection, a
 * sleeping laptop or an expired session therefore delays a word instead of
 * losing it — the same promise the Android outbox makes (ElfaLingo
 * `sync-protocol.done.md`). Each word carries an id generated here, so
 * sending it twice after a lost answer still creates one card.
 */

import { ApiError, api } from './api.js';
import { withAccess } from './session.js';
import * as store from './store.js';

// A safety cap, not a working limit: a month offline is a few dozen words.
export const OUTBOX_LIMIT = 200;

// A word the server keeps failing on (500 every time) must not block the
// words behind it forever.
export const MAX_SERVER_FAILURES = 5;

// Every read-modify-write of the outbox goes through this chain: a click
// arriving while a flush removes a sent word would otherwise overwrite it.
let tail = Promise.resolve();

function exclusive(task) {
  const run = tail.then(task);
  tail = run.catch(() => {});
  return run;
}

/** Queues words; returns the ones that did not fit. */
export function enqueue(lemmas, now = new Date()) {
  return exclusive(async () => {
    const outbox = await store.getOutbox();
    const room = Math.max(0, OUTBOX_LIMIT - outbox.length);
    const accepted = lemmas.slice(0, room).map((lemma) => ({
      id: crypto.randomUUID(),
      lemma,
      addedAt: now.toISOString(),
      // The user's distance from UTC when the word was picked: the server
      // counts it towards that day (ElfaLingo `tech-stack.done.md` §4.5).
      tzOffsetMinutes: -now.getTimezoneOffset(),
      failures: 0,
    }));
    await store.saveOutbox([...outbox, ...accepted]);
    return lemmas.slice(room);
  });
}

export function clear() {
  return exclusive(() => store.saveOutbox([]));
}

function remove(id) {
  return exclusive(async () => {
    const outbox = await store.getOutbox();
    await store.saveOutbox(outbox.filter((item) => item.id !== id));
  });
}

function countFailure(id) {
  return exclusive(async () => {
    const outbox = await store.getOutbox();
    const item = outbox.find((entry) => entry.id === id);
    if (item) {
      item.failures += 1;
      await store.saveOutbox(outbox);
    }
    return item?.failures ?? MAX_SERVER_FAILURES;
  });
}

let flushing = null;
let again = false;

/**
 * Sends everything queued, in order, and reports what happened:
 * `added`, `duplicates` (already in the deck — removed, not an error),
 * `rejected` (the server refused the word itself), `failure` (the error
 * that stopped the pass, or null) and `pending` (words still queued).
 *
 * Calls made while a pass is running join it: the running pass goes round
 * once more to pick up the new words, and everyone gets the combined result.
 */
export function flush() {
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = (async () => {
    const result = { added: [], duplicates: [], rejected: [], failure: null, pending: 0 };
    do {
      again = false;
      result.failure = await pass(result);
    } while (again && !result.failure);
    result.pending = (await store.getOutbox()).length;
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function pass(result) {
  for (const item of await store.getOutbox()) {
    try {
      await withAccess((apiBase, token) =>
        api.createCard(apiBase, token, {
          id: item.id,
          lemma: item.lemma,
          tz_offset_minutes: item.tzOffsetMinutes,
          added_at: item.addedAt,
        }),
      );
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      switch (outcomeOf(error)) {
        case 'duplicate':
          result.duplicates.push(item.lemma);
          await remove(item.id);
          continue;
        case 'rejected':
          result.rejected.push(item.lemma);
          await remove(item.id);
          continue;
        case 'retry':
          if ((await countFailure(item.id)) >= MAX_SERVER_FAILURES) {
            result.rejected.push(item.lemma);
            await remove(item.id);
            continue;
          }
          return error;
        default:
          // No connection, no session, wrong server: the next word would
          // fail the same way, so the pass stops and everything stays queued.
          return error;
      }
    }
    result.added.push(item.lemma);
    await remove(item.id);
  }
  return null;
}

function outcomeOf(error) {
  if (error.kind !== 'http') {
    return 'stop';
  }
  if (error.status === 409 && error.code === 'card_duplicate') {
    return 'duplicate';
  }
  // 408 and 429 are «not now», 404 is a server that lost its /cards route —
  // none of them is about the word.
  if (error.status === 404) {
    return 'stop';
  }
  if (error.status >= 500 || error.status === 408 || error.status === 429) {
    return 'retry';
  }
  // 400, 409 and 422: the word itself was refused (empty after the server's
  // normalisation, too long, …); sending it again gives the same answer.
  return 'rejected';
}
