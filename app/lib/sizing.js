// Position sizing (SPEC.md §5.4a): how many shares a stop-out loss of a chosen share of the book allows, given an entry
// and a stop. Pure arithmetic on numbers the page already has (the book total from the scan, the position's cap, the
// fee rules in portfolio.yaml); nothing here fetches, stores or writes anything, and the result is a sizing aid shown
// on the page, never an order. Long positions only: the stop is below the entry.

/** The risk choices offered, in percent of the book, and the default. */
export const RISK_CHOICES = Object.freeze([0.25, 0.5, 1]);
export const DEFAULT_RISK_PCT = 0.5;

const isPrice = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp + 0;

/** Level types that work as a stop for a long position. */
const STOP_TYPES = new Set(['exit', 'invalidation']);

/**
 * The stop to start from: the nearest active `exit` or `invalidation` level below `entry`, or else a stop written in
 * a level's condition text ("Planned stop: daily close below $141"), as the watchlist files put it. Null when neither.
 * @returns {{price: number, from: string}|null}   `from` says where it came from, for the page
 */
export function defaultStop(levels, entry) {
  if (!isPrice(entry)) return null;
  const active = (levels ?? []).filter((l) => l?.status === 'active' || l?.status === 'unresolved');
  const below = active.filter((l) => STOP_TYPES.has(l.type) && isPrice(l.price) && l.price < entry).sort((a, b) => b.price - a.price)[0];
  if (below) return { price: below.price, from: `${below.type} level ${below.price}` };
  for (const l of active) {
    const m = /\bstop\b[^.$\d]*\$?\s*(\d+(?:[.,]\d+)?)/i.exec(l.condition ?? '');
    const price = m ? Number(m[1].replace(',', '.')) : NaN;
    if (isPrice(price) && price < entry) return { price, from: 'the planned stop in the level\'s condition' };
  }
  return null;
}

/**
 * Shares for a stop-out loss of `riskPct` % of the book.
 * @param {object} a
 * @param {number} a.entry        planned entry, in the trade currency
 * @param {number} a.stop         stop, in the trade currency, below the entry
 * @param {number} a.riskPct      % of the book to lose if the stop is hit at its price
 * @param {number} a.book         book total, in the base currency
 * @param {number} [a.fx]         base currency per unit of trade currency (1 when they are the same)
 * @param {number|null} [a.capPct]    the position's `caps.max_pct_of_book`, if any
 * @param {number} [a.heldUnits]  units already held (a position), counted against the cap
 * @param {number|null} [a.minCourtage]   `rules.min_courtage` for the account and market, base currency
 * @param {number|null} [a.warnPct]       `rules.courtage_warn_pct`
 * @param {number|null} [a.feeFloor]      `rules.fee_floor_per_buy_nok`, base currency
 * @returns {{ok: false, error: string} | {ok: true, [k: string]: any}}
 */
export function sizeTrade({ entry, stop, riskPct, book, fx = 1, capPct = null, heldUnits = 0, minCourtage = null, warnPct = null, feeFloor = null }) {
  if (!isPrice(entry)) return { ok: false, error: 'Type an entry price.' };
  if (!isPrice(stop)) return { ok: false, error: 'Type a stop price.' };
  if (stop >= entry) return { ok: false, error: 'The stop must be below the entry.' };
  if (!isPrice(riskPct)) return { ok: false, error: 'Pick a risk.' };
  if (!isPrice(book)) return { ok: false, error: 'No book total in this scan.' };
  if (!isPrice(fx)) return { ok: false, error: 'No exchange rate in this scan for this currency.' };

  const riskPerShare = entry - stop;
  const budget = (book * riskPct) / 100;
  const byRisk = Math.floor(budget / (riskPerShare * fx) + 1e-9);
  let byCap = null;
  if (isPrice(capPct)) byCap = Math.max(0, Math.floor((book * capPct) / 100 / (entry * fx) + 1e-9) - (heldUnits || 0));
  const shares = byCap === null ? byRisk : Math.min(byRisk, byCap);
  const order = shares * entry * fx;
  const courtagePct = isPrice(minCourtage) && order > 0 ? (minCourtage / order) * 100 : null;
  return {
    ok: true,
    riskPerShare: round(riskPerShare, 4),
    stopPct: round((riskPerShare / entry) * 100, 1),
    budget: round(budget, 0),
    byRisk,
    byCap,
    limitedByCap: byCap !== null && byCap < byRisk,
    shares,
    order: round(order, 0),
    orderPct: round((order / book) * 100, 2),
    loss: round(shares * riskPerShare * fx, 0),
    afterPct: heldUnits ? round((((heldUnits || 0) + shares) * entry * fx) / book * 100, 2) : null,
    courtagePct: courtagePct === null ? null : round(courtagePct, 2),
    courtageWarn: courtagePct !== null && isPrice(warnPct) && courtagePct > warnPct,
    belowFeeFloor: isPrice(feeFloor) && shares > 0 && order < feeFloor,
  };
}

/** Base currency per unit of `currency`, from the scan's rates: 1 for the base currency itself, else `<CUR><BASE>`. */
export function fxFor(currency, base, scan) {
  if (!currency || currency === base) return 1;
  const rate = scan?.fx?.[`${currency}${base}`]?.rate;
  return isPrice(rate) ? rate : null;
}
