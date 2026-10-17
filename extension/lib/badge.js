/**
 * The toolbar icon: the only place the extension speaks without being opened.
 *
 * A lasting problem stays on the icon until it is gone: «!» on a grey cat
 * when the server cannot be reached, «!» in amber when nobody is signed in.
 * The result of sending a word is shown for a few seconds and then cleared:
 * «✓» (or «+3» for a list) — sent, «=» — the deck already had it,
 * «×» — not added. The tooltip spells out the same in words.
 */

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

const FLASH_MS = 4000;

const COLORS = {
  added: '#2E7D32',
  duplicate: '#6D5446',
  rejected: '#C62828',
  sending: '#757575',
  problem: '#C62828',
  signedOut: '#E37400',
};

const ICONS = {
  normal: { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' },
  off: { 16: '/icons/icon-16-off.png', 32: '/icons/icon-32-off.png' },
};

// Problems that mean «the user has to sign in», as opposed to «wait».
const SIGN_IN_PROBLEMS = new Set(['signed_out', 'account_disabled']);

let flashTimer = null;

/** The lasting state: problem or quiet, plus the tooltip. */
export async function render(status) {
  clearTimeout(flashTimer);
  const problem = status?.problem ?? null;
  await Promise.all([
    chrome.action.setIcon({ path: problem === 'unreachable' ? ICONS.off : ICONS.normal }),
    setBadge(
      problem ? '!' : '',
      SIGN_IN_PROBLEMS.has(problem) ? COLORS.signedOut : COLORS.problem,
    ),
    chrome.action.setTitle({ title: tooltip(status) }),
  ]);
}

export async function sending() {
  clearTimeout(flashTimer);
  await setBadge('…', COLORS.sending);
}

/**
 * Shows the outcome of a send for a few seconds, then the lasting state.
 * A problem wins over the outcome: «✓» next to a dead connection would say
 * all is well while words are waiting.
 */
export async function flash(status) {
  const last = status.last;
  if (status.problem || !last) {
    await render(status);
    return;
  }

  let text;
  let color;
  if (last.added.length > 0) {
    text = last.added.length === 1 ? '✓' : `+${Math.min(last.added.length, 99)}`;
    color = COLORS.added;
  } else if (last.duplicates.length > 0) {
    text = '=';
    color = COLORS.duplicate;
  } else {
    text = '×';
    color = COLORS.rejected;
  }

  await render(status);
  await setBadge(text, color);
  // The worker stays alive while a timer this short is pending; if it is
  // stopped anyway, the next event renders the lasting state again.
  flashTimer = setTimeout(() => {
    setBadge('', COLORS.added).catch(() => {});
  }, FLASH_MS);
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setBadgeText({ text });
}

/** The tooltip, one fact per line. Also shown on the options page. */
export function tooltip(status) {
  const lines = [t('extName')];
  const problem = status?.problem ?? null;

  lines.push(problem ? t(`problem_${problem}`) : t('titleIdle'));
  if (status?.pending > 0) {
    lines.push(t('titlePending', [String(status.pending)]));
  }
  lines.push(...describeLast(status?.last));
  return lines.join('\n');
}

export function describeLast(last) {
  if (!last) {
    return [];
  }
  const lines = [];
  if (last.added.length) {
    lines.push(t('resultAdded', [quoteAll(last.added)]));
  }
  if (last.duplicates.length) {
    lines.push(t('resultDuplicate', [quoteAll(last.duplicates)]));
  }
  if (last.rejected.length) {
    lines.push(t('resultRejected', [quoteAll(last.rejected)]));
  }
  if (!lines.length && last.empty) {
    lines.push(t('resultNothing'));
  }
  return lines;
}

function quoteAll(words) {
  const shown = words.slice(0, 5).map((word) => t('quoted', [word]));
  if (words.length > 5) {
    shown.push(t('andMore', [String(words.length - 5)]));
  }
  return shown.join(', ');
}
