/**
 * What becomes of the text selected on a page — the browser's counterpart of
 * Android's «⋮ → ElfaLingo» (ElfaLingo `docs/features/word-intake.md`, way 5).
 *
 * A port of `lib/domain/services/lemma_list.dart` from the app, with one
 * difference. Android puts the selection into the «+» dialog, where the user
 * fixes it before pressing «Добавить». Here nothing stands between the menu
 * and the server, so each entry of a list is cleaned of edge punctuation on
 * its own (`„Hund“, „Katze“` gives two clean words, not `Hund“` and `„Katze`),
 * and an entry too long to be a word is refused here rather than by the server.
 */

// The server's column (`backend/app/models/card.py`, LEMMA_MAX_LENGTH).
export const LEMMA_MAX_LENGTH = 100;

// Longer than this is a paragraph selected by mistake, not a list of words.
// A real vocabulary list of thirty words fits with room to spare.
export const SELECTION_MAX_LENGTH = 1000;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const LAST_WORD_CHAR = /[\p{L}\p{N}](?=[^\p{L}\p{N}]*$)/u;
const BRACKETS = [
  ['(', ')'],
  ['[', ']'],
];

// Web pages hyphenate with soft hyphens and glue text with zero-width
// characters; copied into a card they make `Wör­ter` a different word from
// `Wörter` that looks identical on screen.
const INVISIBLE = /[­​-‍⁠﻿]/gu;

const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/**
 * Trims, collapses inner whitespace and applies NFC, as the server does
 * (`backend/app/core/text.py`). The key folds case and umlauts the same way
 * the server's deduplication key does; it is only used to drop a repeat
 * inside one selection, the server remains the authority on the deck.
 */
export function normalizeLemma(raw) {
  const lemma = raw.split(/\s+/u).filter(Boolean).join(' ').normalize('NFC');
  const key = lemma.toLowerCase().replace(/[äöüß]/gu, (c) => UMLAUTS[c]);
  return { lemma, key };
}

/**
 * Splits a selection into the words to add.
 *
 * Returns `lemmas` to send and `rejected` — entries that are not words
 * (too long), shown to the user rather than silently dropped. A selection
 * with no letters or digits at all gives two empty lists.
 */
export function parseSelection(text) {
  const flat = normalizeLemma((text ?? '').replace(INVISIBLE, '')).lemma;
  if (flat.length > SELECTION_MAX_LENGTH) {
    return { lemmas: [], rejected: [preview(flat)] };
  }

  const seen = new Set();
  const lemmas = [];
  const rejected = [];

  for (const part of flat.split(',')) {
    const { lemma, key } = normalizeLemma(trimEdges(part));
    if (!lemma) {
      // A trailing comma or a stray dash is how text looks, not an error.
      continue;
    }
    if (lemma.length > LEMMA_MAX_LENGTH) {
      rejected.push(preview(lemma));
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      lemmas.push(lemma);
    }
  }

  return { lemmas, rejected };
}

/**
 * Cuts what is not a letter or a digit off both ends, as the app does
 * (`selectionToInput`), except a bracket the word itself opened or closed:
 * vocabulary lists write `(sich) freuen` and `freuen (über)`, and in the app
 * the user would put the cut bracket back before adding — here nobody can.
 */
function trimEdges(part) {
  let start = part.search(WORD_CHAR);
  if (start < 0) {
    return '';
  }
  let end = part.search(LAST_WORD_CHAR) + 1;

  for (const [open, close] of BRACKETS) {
    const inner = part.slice(start, end);
    const balance = count(inner, open) - count(inner, close);
    if (balance < 0 && part[start - 1] === open) {
      start -= 1;
    } else if (balance > 0 && part[end] === close) {
      end += 1;
    }
  }
  return part.slice(start, end);
}

function count(text, char) {
  return text.split(char).length - 1;
}

/** A long text shortened for a tooltip line. */
export function preview(text, max = 40) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
