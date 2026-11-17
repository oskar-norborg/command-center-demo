// Small pure helpers with no imports of their own, shared by the scan, lib/portfolio.js
// and (shipped to dist/lib/ beside lib/housekeeping.js) the browser, so a date or a
// "usable number" test has one definition everywhere.

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The plausible USDNOK band (the owner, 2026-09-21, Phase 2 audit finding 9; his to change). One definition for the
 * scan's FX step and /log-trade's contract-note rate, so a rate one accepts the other never rejects.
 */
export const USDNOK_PLAUSIBLE_RANGE = Object.freeze({ min: 7, max: 14 });

/** A finite number above zero. */
export const isPositive = (n) => Number.isFinite(n) && n > 0;

const dayMs = (iso) => Date.parse(ISO_DATE.test(iso) ? `${iso}T00:00:00Z` : iso);

/**
 * Whole calendar days from one ISO date to another, counted between UTC midnights so
 * a daylight-saving change never shifts the result; negative when `toIso` is earlier.
 */
export function daysBetween(fromIso, toIso) {
  return Math.round((dayMs(toIso) - dayMs(fromIso)) / 86_400_000);
}

const DAY_CHANGE_EXCLUDED_TEXT = Object.freeze({
  'last-good-price': 'last good price',
  'earlier-session': 'price from an earlier session',
  'no-session': 'exchange closed',
  'no-baseline': 'no baseline price',
  'not-valued': 'not valued',
});

/**
 * The names a book's day change leaves out, as one phrase for the briefing and the Book panel:
 * `XYZ.OL (last good price), DEFG (no baseline price)`. Empty string when nothing is left out.
 * @param {{ticker: string, reason: string}[]|undefined} excluded   `book.day_change_excluded`
 */
export function dayChangeExcludedText(excluded) {
  return (excluded ?? []).map((e) => `${e.ticker} (${DAY_CHANGE_EXCLUDED_TEXT[e.reason] ?? e.reason})`).join(', ');
}

const UNCONFIRMED_PRICE_TEXT = Object.freeze({
  'last-good-price': 'last good',
  'earlier-session': 'from',
  intraday: 'intraday',
  unconfirmed: 'unconfirmed',
});

/**
 * The prices behind a book's `≈` (pre-publish audit H1, 2026-09-24), as one phrase for alert titles, the briefing and
 * the site: `ABC.OL from 2026-09-23, DEFG undated, XYZ.OL intraday 2026-09-24`. Empty string when there are none.
 * @param {{ticker: string, reason: string, as_of: string|null}[]|undefined} list   `book.unconfirmed_prices`
 */
export function unconfirmedPricesText(list) {
  return (list ?? []).map((e) => (e.reason === 'undated' || !e.as_of
    ? `${e.ticker} undated`
    : `${e.ticker} ${UNCONFIRMED_PRICE_TEXT[e.reason] ?? e.reason} ${e.as_of}`)).join(', ');
}

/**
 * What a percentage of the book rests on (Appendix B): the oldest fund NAV date, and every price that is not the
 * session's confirmed close: `basis 2026-09-14; prices not at the close: ABC.OL from 2026-09-23`.
 * @param {{oldest_fund_nav_date?: string|null, unconfirmed_prices?: object[]}|null|undefined} book
 */
export function bookBasisText(book) {
  const nav = book?.oldest_fund_nav_date ? `basis ${book.oldest_fund_nav_date}` : 'no fund NAV basis';
  const prices = unconfirmedPricesText(book?.unconfirmed_prices);
  return prices ? `${nav}; prices not at the close: ${prices}` : nav;
}
