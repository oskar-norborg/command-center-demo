// Voice grammar (SPEC.md §5.10, docs/phase3-plan.md §7 T3.6): matches a
// lowercase transcript against the six commands. Pure — no Web Speech API,
// no DOM — so components/mic.js only has to call `matchVoiceCommand` and act
// on the result; testable without a browser.

/** The alias list shown for an unmatched transcript (SPEC.md §5.10). */
export const ALIASES = Object.freeze([
  'show me <name>',
  'open <name>',
  "what's near a sell level",
  "what's near a buy level",
  'watchlist',
  'journal',
  'home',
]);

const SELL_RE = /^whats near a sell level$/;
const BUY_RE = /^whats near a buy level$/;
const DOSSIER_RE = /^(?:show me|open)\s+(.+?)\s*$/;

/** Lowercase, drop punctuation a speech engine wouldn't reliably transcribe anyway, and collapse whitespace — the
 * same normalisation applied to both the transcript and the candidate names, so "ABC.OL" matches "abc ol" and
 * "Example Holdings ASA" matches on a word-boundary basis, not a literal ticker spelled out with a dot. Apostrophes
 * are deleted outright, not turned into a space, so "what's" and "whats" (a speech engine drops contractions
 * unpredictably) both normalise the same way. */
function normalise(s) {
  return s.toLowerCase().replace(/'/g, '').replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} transcript   raw (not yet lowercased) speech-recognition text
 * @param {{names?: {ticker: string, name?: string}[]}} [args]   every position/watchlist entry a "show me"/"open"
 *   command may resolve to — ticker is required, name is the company name if known
 * @returns {
 *   {type: 'dossier', ticker: string} |
 *   {type: 'filter', want: 'sell'|'buy'} |
 *   {type: 'route', name: 'watchlist'|'journal'|'home'} |
 *   {type: 'unmatched', transcript: string}
 * }
 */
export function matchVoiceCommand(transcript, { names = [] } = {}) {
  const t = normalise(transcript ?? '');
  if (!t) return { type: 'unmatched', transcript: transcript ?? '' };

  if (SELL_RE.test(t)) return { type: 'filter', want: 'sell' };
  if (BUY_RE.test(t)) return { type: 'filter', want: 'buy' };
  if (t === 'watchlist') return { type: 'route', name: 'watchlist' };
  if (t === 'journal') return { type: 'route', name: 'journal' };
  if (t === 'home') return { type: 'route', name: 'home' };

  const dossier = DOSSIER_RE.exec(t);
  if (dossier) {
    const wanted = normalise(dossier[1]);
    const match = names.find((n) => normalise(n.ticker) === wanted || (n.name && normalise(n.name) === wanted));
    if (match) return { type: 'dossier', ticker: match.ticker };
  }

  return { type: 'unmatched', transcript: transcript ?? '' };
}
