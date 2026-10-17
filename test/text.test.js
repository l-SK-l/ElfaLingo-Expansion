import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LEMMA_MAX_LENGTH, SELECTION_MAX_LENGTH, parseSelection, preview } from '../extension/lib/text.js';

const lemmas = (text) => parseSelection(text).lemmas;

test('a plain word is taken as it is', () => {
  assert.deepEqual(lemmas('Hund'), ['Hund']);
});

test('quotes, punctuation and line breaks around a selection are cut', () => {
  assert.deepEqual(lemmas('  „Hund“.\n'), ['Hund']);
  assert.deepEqual(lemmas('der\nHund,'), ['der Hund']);
});

test('a comma-separated list becomes separate words, each cleaned on its own', () => {
  assert.deepEqual(lemmas('„Hund“, „Katze“, die Maus.'), ['Hund', 'Katze', 'die Maus']);
});

test('inner whitespace collapses', () => {
  assert.deepEqual(lemmas('der \t  Koffer'), ['der Koffer']);
});

test('a repeat inside one selection is dropped, folding case and umlauts like the server', () => {
  assert.deepEqual(lemmas('Hund, hund, HUND'), ['Hund']);
  assert.deepEqual(lemmas('Löffel, Loeffel'), ['Löffel']);
  assert.deepEqual(lemmas('Straße, Strasse'), ['Straße']);
});

test('soft hyphens and zero-width characters from web pages are removed', () => {
  assert.deepEqual(lemmas('Wör­ter'), ['Wörter']);
  assert.deepEqual(lemmas('​Hund﻿'), ['Hund']);
});

test('a decomposed umlaut is composed (NFC)', () => {
  assert.deepEqual(lemmas('über'), ['über']);
});

test('brackets that belong to the word are kept', () => {
  assert.deepEqual(lemmas('(sich) freuen'), ['(sich) freuen']);
  assert.deepEqual(lemmas('freuen (über).'), ['freuen (über)']);
  assert.deepEqual(lemmas('der Tisch [-e]'), ['der Tisch [-e]']);
  // A bracket around the whole selection is not the word's.
  assert.deepEqual(lemmas('(Hund)'), ['Hund']);
});

test('a selection with no letters or digits gives nothing, and is not an error', () => {
  assert.deepEqual(parseSelection('— , …'), { lemmas: [], rejected: [] });
  assert.deepEqual(parseSelection(''), { lemmas: [], rejected: [] });
  assert.deepEqual(parseSelection(undefined), { lemmas: [], rejected: [] });
});

test('digits are words too', () => {
  assert.deepEqual(lemmas('1990er'), ['1990er']);
});

test('an entry longer than the server column is rejected, the rest still goes', () => {
  const long = 'a'.repeat(LEMMA_MAX_LENGTH + 1);
  const { lemmas: words, rejected } = parseSelection(`Hund, ${long}`);
  assert.deepEqual(words, ['Hund']);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].endsWith('…'));
});

test('an entry exactly at the limit is accepted', () => {
  const word = 'a'.repeat(LEMMA_MAX_LENGTH);
  assert.deepEqual(lemmas(word), [word]);
});

test('a paragraph selected by mistake is refused as a whole', () => {
  const paragraph = 'Wort, '.repeat(Math.ceil(SELECTION_MAX_LENGTH / 6) + 1);
  const { lemmas: words, rejected } = parseSelection(paragraph);
  assert.deepEqual(words, []);
  assert.equal(rejected.length, 1);
});

test('preview shortens only what is too long', () => {
  assert.equal(preview('Hund'), 'Hund');
  assert.equal(preview('x'.repeat(50), 10), `${'x'.repeat(9)}…`);
});
