// The book (SPEC.md §4.6): values every position and fund from injected state,
// quotes and FX, and returns the `book` and `positions` parts of the scan
// output. No file, network or clock access: `today` is passed in, and the tests
// run on plain objects.
//
// Shared by the scan and the site (#91, the owner, 2026-10-01): one definition of the book. The scan values the state
// it reads at scan time; the site (`liveBook`, below) values the current state at the scan's prices with the same
// function and the inputs the scan published in `book_inputs`, so the command view never shows the units, GAV or
// cash of an older state. Dependency-free apart from lib/ files the build ships to dist/lib/.
//
// Missing inputs never turn into invented numbers (§4.6, decided 2026-09-19):
//   - a quote with no usable price is valued at its last good price, flagged
//     stale; with none, the position is left out of `positions` and the totals;
//   - USD positions with no USDNOK rate at all are left out the same way;
//   - a fund with no NAV contributes nothing.
// Every one of these makes the book `approximate`, which is what marks each
// `pct_of_book` as approximate, and the first two also degrade the run.
//
// A price that is not the confirmed close of the session being valued does the
// same (the owner, 2026-09-24, pre-publish audit H1): an undated price, a print from
// during a session, or an unconfirmed one makes the book `approximate` and, when
// it is measured in the day change, the day change too; a price from an earlier
// session is not today's move, so the day change leaves it out and says so. Every
// such name is listed in `book.unconfirmed_prices`, the basis the `≈` stands for.
//
// `positions[t].levels` is deliberately absent: T2.6 owns level states, and the
// scan schema requires the field, so an orchestrator that forgets to attach it
// fails validation loudly instead of publishing an empty list.

import { LABELS, calendarExchange } from './label-names.js';
import {
  ISO_DATE,
  assessFunds,
  dayChange,
  deriveCapState,
  isTradeEntry,
  fromOre,
  fundHoldings,
  heldCapState,
  isPositive,
  pnlSummary,
  round2,
  stockOre,
  techExposure,
  toOre,
} from './portfolio.js';

export const DAY_CHANGE_SCOPE = 'stocks-only';

/**
 * @typedef {object} BookResult
 * @property {object} book        `book` of schemas/scan.schema.json; its day change is null, with `day_change_reason`, when no position has a baseline
 * @property {Record<string, object>} positions   `positions` minus `levels`, valued positions only
 * @property {boolean} degraded   a price problem: the run should be `degraded` (FX problems are the FX step's)
 * @property {string[]} reasons   one line each, for `run.status_reasons`
 * @property {string[]} approximateReasons   every reason `book.approximate` is true, NAV ones included
 * @property {{ticker: string, reason: string}[]} unvalued   positions left out of the book
 * @property {{ticker: string, price: number, as_of: string|null}[]} stalePriced   positions valued at a last good price
 * @property {{ticker: string, reason: string, as_of: string|null}[]} unconfirmedPrices   positions valued at anything but
 *   the confirmed close of the session being valued, and why (`book.unconfirmed_prices`)
 * @property {{ticker: string, reason: string}[]} dayChangeExcluded   positions whose day change could not be computed (a
 *   baseline was expected and not found; a closed exchange or a last-good price is not listed here). Not published: `book.day_change_excluded` is
 * @property {{ore: number, pct: number, capPct: number, breached: boolean}} tech   for T2.6's tech-cap alert
 * @property {Record<string, object>} funds   the scan output's `funds`: one entry per fund in portfolio.yaml, valued or not
 */

/**
 * Why a live quote's price is not the confirmed close of the session being valued, or null when it is (H1, 2026-09-24):
 * `earlier-session` (dated a session before it), `undated`, `intraday` (a print from during a session) or `unconfirmed`
 * (any other label on that session). `session` is the exchange's last completed session, the one the alerts step judges
 * levels against; without one nothing is confirmed.
 * @param {{label?: string, session_date?: string|null}|undefined} quote
 * @param {string|null|undefined} session
 * @returns {'earlier-session'|'undated'|'intraday'|'unconfirmed'|null}
 */
export function priceStanding(quote, session) {
  const date = ISO_DATE.test(quote?.session_date ?? '') ? quote.session_date : null;
  if (quote?.label === LABELS.CONFIRMED_CLOSE && date !== null && date === session) return null;
  if (date === null) return 'undated';
  if (ISO_DATE.test(session ?? '') && date < session) return 'earlier-session';
  if (quote?.label === LABELS.INTRADAY) return 'intraday';
  return 'unconfirmed';
}

/** The session being valued for a position's exchange, or null (unknown exchange: fail closed). */
function sessionOf(position, sessions) {
  try {
    return sessions?.[calendarExchange(position?.exchange)] ?? null;
  } catch {
    return null;
  }
}

/** A `{price, as_of}` pair, or null if absent or malformed. */
function usableLastGood(...candidates) {
  for (const c of candidates) {
    if (isPositive(c?.price)) return { price: c.price, as_of: ISO_DATE.test(c.as_of ?? '') ? c.as_of : null };
  }
  return null;
}

/**
 * @param {object} args
 * @param {object} args.portfolio   parsed data/portfolio.yaml
 * @param {object} args.marks       parsed data/marks.yaml
 * @param {Record<string, object>} args.positions   ticker → position front matter (units, gav, currency, account, caps)
 * @param {Record<string, object>} args.quotes      ticker → `quotes` entry from `fetchQuotes`
 * @param {Record<string, object>} args.fx          the scan's `fx` object: `{USDNOK: {rate, flags, ...}}` or `{}`
 * @param {Record<string, number>} [args.previousPrices]   ticker → previous scan's price; the baseline when a quote's
 *   `change_basis` is `last-scan` (its `prev_close` is null then)
 * @param {Record<string, {price: number, as_of: string}>} [args.lastGood]   ticker → last trusted price. Only used
 *   for a quote that has neither a price nor its own `last_good`, i.e. a two-source-disagreement range, which the
 *   scan schema forbids from carrying one. Pass the same map given to `fetchQuotes`.
 * @param {{ticker: string, action: string, units: number}[]} [args.journal]   journal front matter, all tickers
 * @param {Record<string, string>} [args.previousCaps]   ticker → the previous close's `cap_state`, for the hysteresis band
 * @param {string} args.today   ISO date NAV ages are measured to
 * @param {{NYSE?: string, OSE?: string}} [args.sessions]   exchange → the session being valued (its last completed session,
 *   the same map the alerts step gets). A price is a confirmed close only for its exchange's entry; with none, none is.
 * @returns {BookResult}
 */
export function buildBook({ portfolio, marks, positions, quotes, fx, previousPrices = {}, lastGood = {}, journal = [], previousCaps = {}, today, sessions = {} }) {
  const rules = portfolio.rules ?? {};
  // The base currency (portfolio.yaml `base_currency`, NOK unless it says USD). A position in the base currency needs
  // no rate; a USD position in a NOK book is converted at USDNOK. A NOK position in a USD book is not supported.
  const base = portfolio.base_currency === 'USD' ? 'USD' : 'NOK';
  const usdnok = fx?.USDNOK;
  const rate = base === 'NOK' && isPositive(usdnok?.rate) ? usdnok.rate : null;

  const approximateReasons = [];
  const reasons = [];
  const unvalued = [];
  const stalePriced = [];
  const unconfirmedPrices = [];
  const dayChangeExcluded = [];

  // --- funds ---------------------------------------------------------------
  const funds = assessFunds({
    funds: portfolio.funds ?? [],
    navs: marks.navs,
    today,
    staleDays: rules.fund_nav_stale_days ?? 14,
  });
  approximateReasons.push(...funds.reasons);
  const fundOre = {};
  for (const v of funds.values) fundOre[v.id] = (fundOre[v.id] ?? 0) + v.ore;

  // --- stocks --------------------------------------------------------------
  const valued = []; // {ticker, pos, valueOre, costOre, basis, dayRow}
  let usdValued = false;
  for (const [ticker, pos] of Object.entries(positions)) {
    const quote = quotes?.[ticker];
    const usd = pos.currency !== base;
    const leave = (reason) => {
      unvalued.push({ ticker, reason });
      approximateReasons.push(`${ticker} left out of the book: ${reason}`);
      reasons.push(`${ticker} not valued: ${reason}`);
    };
    if (usd && rate === null) {
      leave(base === 'NOK' ? 'no USDNOK rate' : `no rate from ${pos.currency} to ${base}`);
      continue;
    }

    let price = isPositive(quote?.price) ? quote.price : null;
    let live = true;
    let priced = { source: 'quote', price: null, as_of: ISO_DATE.test(quote?.session_date ?? '') ? quote.session_date : null };
    if (price === null) {
      const good = usableLastGood(quote?.last_good, lastGood[ticker]);
      if (good === null) {
        leave('no usable price and no last good price');
        continue;
      }
      price = good.price;
      live = false;
      priced = { source: 'last-good', price, as_of: good.as_of };
      stalePriced.push({ ticker, price, as_of: good.as_of });
      unconfirmedPrices.push({ ticker, reason: 'last-good-price', as_of: good.as_of });
      const when = good.as_of ? ` (${good.as_of})` : '';
      approximateReasons.push(`${ticker} valued at last good price ${price}${when}`);
      reasons.push(`${ticker} valued at last good price ${price}${when}, stale`);
    }

    // Anything but the confirmed close of the session being valued marks what is computed from it (H1).
    const session = sessionOf(pos, sessions);
    const standing = live ? priceStanding(quote, session) : 'last-good-price';
    if (live && standing !== null) {
      const asOf = ISO_DATE.test(quote.session_date ?? '') ? quote.session_date : null;
      unconfirmedPrices.push({ ticker, reason: standing, as_of: asOf });
      approximateReasons.push(`${ticker} is not priced at the ${session ?? 'session'} confirmed close (${standing}${asOf ? `, ${asOf}` : ''})`);
    }

    const fxRate = usd ? rate : 1;
    if (usd) usdValued = true;
    const valueOre = stockOre({ units: pos.units, price, fxRate });
    const costOre = stockOre({ units: pos.units, price: pos.gav, fxRate });

    // Day change needs a fresh price and a baseline; the quote step already
    // decided whether one exists (`change_pct` is null on no-session days). A price
    // from an earlier session carries that session's move, not today's: left out.
    let dayRow = { nowOre: valueOre, prevOre: null };
    if (live && standing !== 'earlier-session' && quote.change_pct !== null && quote.change_pct !== undefined) {
      const base = quote.change_basis === 'prev-session' ? quote.prev_close : previousPrices[ticker];
      if (isPositive(base)) dayRow = { nowOre: valueOre, prevOre: stockOre({ units: pos.units, price: base, fxRate }) };
      else dayChangeExcluded.push({ ticker, reason: `no ${quote.change_basis ?? 'baseline'} price to measure the move from` });
    }
    priced.price = price;
    valued.push({ ticker, pos, valueOre, costOre, dayRow, live, standing, priced, noSession: quote?.flags?.includes('no-session') === true });
  }
  if (usdValued && usdnok?.flags?.includes('stale')) {
    approximateReasons.push(`USDNOK rate is stale (as of ${usdnok.as_of}); US positions valued at it`);
  }

  // --- cash and totals -----------------------------------------------------
  const cashByAccount = {};
  for (const [account, entry] of Object.entries(marks.cash ?? {})) cashByAccount[account] = toOre(entry.nok);
  const cashOre = Object.values(cashByAccount).reduce((a, b) => a + b, 0);
  const stocksOre = valued.reduce((a, v) => a + v.valueOre, 0);
  const fundsOre = funds.values.reduce((a, v) => a + v.ore, 0);
  const totalOre = stocksOre + fundsOre + cashOre;
  const pctOf = (ore) => (totalOre > 0 ? (ore / totalOre) * 100 : 0);

  const byAccountOre = {};
  const add = (account, ore) => { byAccountOre[account] = (byAccountOre[account] ?? 0) + ore; };
  for (const account of Object.keys(portfolio.accounts ?? {})) add(account, 0);
  for (const v of valued) add(v.pos.account, v.valueOre);
  for (const v of funds.values) add(v.account, v.ore);
  for (const [account, ore] of Object.entries(cashByAccount)) add(account, ore);

  const approximate = approximateReasons.length > 0;

  // --- tech exposure -------------------------------------------------------
  const positionOre = Object.fromEntries(valued.map((v) => [v.ticker, v.valueOre]));
  const tech = techExposure({
    members: rules.tech_bucket_members ?? [],
    fundOre,
    positionOre,
    totalOre,
    capPct: rules.tech_cap_pct,
  });

  // --- day change ----------------------------------------------------------
  const change = dayChange(valued.map((v) => v.dayRow), cashOre);
  // Nothing to measure is null, never 0, and says why: `no-session` when every position priced live today comes from a
  // day its exchange did not trade (a weekend or holiday run), `no-baseline` otherwise (positions priced at a last good
  // price are no evidence either way).
  const livePriced = valued.filter((v) => v.live);
  const dayChangeReason = change !== null ? null : livePriced.length > 0 && livePriced.every((v) => v.noSession) ? 'no-session' : 'no-baseline';

  // Every name the day change does not measure, and why, so a partial number is never read as the whole book's. A
  // position with no measured baseline still sits in the percentage's base at its current value (`dayChange`).
  const dayChangeExcludedOut = [
    ...valued.filter((v) => v.dayRow.prevOre === null).map((v) => ({
      ticker: v.ticker,
      reason: !v.live ? 'last-good-price' : v.standing === 'earlier-session' ? 'earlier-session' : v.noSession ? 'no-session' : 'no-baseline',
    })),
    ...unvalued.map((u) => ({ ticker: u.ticker, reason: 'not-valued' })),
  ].sort((a, b) => a.ticker.localeCompare(b.ticker));

  // --- positions -----------------------------------------------------------
  const positionsOut = {};
  for (const v of valued) {
    const pct = pctOf(v.valueOre);
    const capPct = v.pos.caps?.max_pct_of_book ?? null;
    const pnlOre = v.valueOre - v.costOre;
    const journalEntries = journal.filter((e) => e.ticker === v.ticker);
    const held = heldCapState({ pctOfBook: pct, capPct, previousState: previousCaps[v.ticker] });
    const capState = held ?? deriveCapState({
      pctOfBook: pct,
      capPct,
      units: v.pos.units,
      journalEntries,
      costPct: totalOre > 0 ? (v.costOre / totalOre) * 100 : 0,
    });
    positionsOut[v.ticker] = {
      value_nok: fromOre(v.valueOre),
      cost_nok: fromOre(v.costOre),
      pnl_nok: fromOre(pnlOre),
      pnl_pct: round2((pnlOre / v.costOre) * 100),
      // This name's share of the book's day change (2026-09-23, the owner: calculated in the scan, not the site): the row
      // `dayChange` sums, so the positions' figures add up to `book.day_change_nok` exactly. Null when the name has no
      // baseline to measure from; `book.day_change_excluded` says why.
      day_change_nok: v.dayRow.prevOre === null ? null : fromOre(v.dayRow.nowOre - v.dayRow.prevOre),
      pct_of_book: round2(pct),
      pct_basis_date: funds.oldestNavDate,
      pct_approximate: approximate,
      priced: v.priced,
      cap_pct: capPct,
      cap_state: capState,
      // Why the state is what it is, for the alert and the dossier (optional in the schema): `cap_held` when it is the
      // last close's state kept inside the hysteresis band, else `cap_basis` when over the cap.
      ...(held ? { cap_held: true } : capState !== 'clear' ? { cap_basis: journalEntries.some(isTradeEntry) ? 'journal' : 'cost-basis' } : {}),
    };
  }

  // --- funds, one row each, and P&L against GAV (2026-09-23, the owner: the command view's numbers are calculated here) ---
  const fundRows = fundHoldings({ funds: portfolio.funds ?? [], navs: marks.navs, values: funds.values, totalOre });
  const fundsOut = Object.fromEntries(fundRows.map((f) => [f.id, {
    value_nok: f.valueOre === null ? null : fromOre(f.valueOre),
    cost_nok: f.costOre === null ? null : fromOre(f.costOre),
    pnl_nok: f.valueOre === null || f.costOre === null ? null : fromOre(f.valueOre - f.costOre),
    pnl_pct: f.valueOre === null || f.costOre === null || f.costOre === 0 ? null : round2(((f.valueOre - f.costOre) / f.costOre) * 100),
    pct_of_book: f.pctOfBook === null ? null : round2(f.pctOfBook),
    nav: f.nav,
    nav_as_of: f.navAsOf,
  }]));
  const stockPnl = pnlSummary(valued.map((v) => ({ valueOre: v.valueOre, costOre: v.costOre })));
  const valuedFunds = fundRows.filter((f) => f.valueOre !== null);
  const fundPnl = pnlSummary(valuedFunds);
  const holdingsPnl = stockPnl && fundPnl ? pnlSummary([...valued.map((v) => ({ valueOre: v.valueOre, costOre: v.costOre })), ...valuedFunds]) : null;
  const pnlOut = (s) => (s === null ? null : { cost_nok: fromOre(s.costOre), pnl_nok: fromOre(s.pnlOre), pnl_pct: s.pct });

  const book = {
    total_nok: fromOre(totalOre),
    stocks_nok: fromOre(stocksOre),
    funds_nok: fromOre(fundsOre),
    cash_nok: fromOre(cashOre),
    oldest_fund_nav_date: funds.oldestNavDate,
    approximate,
    day_change_nok: change === null ? null : fromOre(change.changeOre),
    day_change_pct: change === null ? null : change.pct,
    day_change_scope: DAY_CHANGE_SCOPE,
    day_change_reason: dayChangeReason,
    day_change_excluded: dayChangeExcludedOut,
    // `≈` on the day change: a name it measures is priced at something other than the session's confirmed close (H1).
    day_change_approximate: change !== null && valued.some((v) => v.dayRow.prevOre !== null && v.standing !== null),
    // The prices behind the `≈` (H1): every valued name not priced at the confirmed close of the session, and why.
    unconfirmed_prices: [...unconfirmedPrices].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    allocation: { funds: round2(pctOf(fundsOre)), stocks: round2(pctOf(stocksOre)), cash: round2(pctOf(cashOre)) },
    by_account: Object.fromEntries(Object.entries(byAccountOre).map(([a, ore]) => [a, fromOre(ore)])),
    tech_pct: round2(tech.pct),
    tech_cap_pct: tech.capPct,
    // P&L against GAV: stocks (cost at today's USDNOK, §4.6), funds (units × GAV per account), and both together. Each
    // is null when any holding in it has no value or no cost, so a partial sum never reads as the whole. Cash has none.
    pnl: { stocks: pnlOut(stockPnl), funds: pnlOut(fundPnl), holdings: pnlOut(holdingsPnl) },
  };

  return {
    book,
    positions: positionsOut,
    funds: fundsOut,
    degraded: unvalued.length > 0 || stalePriced.length > 0,
    reasons,
    approximateReasons,
    unvalued,
    stalePriced,
    unconfirmedPrices,
    dayChangeExcluded,
    tech,
  };
}

/**
 * What changed in the holdings between the state a scan valued (`book_inputs`) and the current state: units or GAV of
 * a position, a name bought or sold since, an account's cash. Null for a scan without `book_inputs`.
 * @param {{state: object, scan: object}} args
 * @returns {{kind: 'units'|'gav'|'bought'|'sold'|'cash', key: string, from: number|null, to: number|null}[]|null}
 */
export function holdingChanges({ state, scan }) {
  const inputs = scan?.book_inputs;
  if (!inputs) return null;
  const out = [];
  const before = inputs.holdings ?? {};
  const now = state?.positions ?? {};
  for (const [t, p] of Object.entries(now)) {
    const b = before[t];
    if (!b) out.push({ kind: 'bought', key: t, from: null, to: p.units });
    else {
      if (b.units !== p.units) out.push({ kind: 'units', key: t, from: b.units, to: p.units });
      if (b.gav !== p.gav) out.push({ kind: 'gav', key: t, from: b.gav, to: p.gav });
    }
  }
  for (const [t, b] of Object.entries(before)) if (!now[t]) out.push({ kind: 'sold', key: t, from: b.units, to: null });
  for (const [a, c] of Object.entries(state?.marks?.cash ?? {})) {
    const b = inputs.cash?.[a];
    if (b?.nok !== c?.nok) out.push({ kind: 'cash', key: a, from: b?.nok ?? null, to: c?.nok ?? null });
  }
  return out;
}

/**
 * The book of the **current** state at a scan's prices (#91, the owner, 2026-10-01): the same `buildBook`, given today's
 * units, GAV, cash, NAVs and journal from state.json and the scan's quotes, FX and `book_inputs` (its date, sessions,
 * the previous close's cap states for the hysteresis band, previous prices and last good prices). Labels, `≈` and the
 * cap state follow from the same rules as in the scan. A name held since the scan is valued at the scan's quote for it
 * if there is one (a watchlist name has one), else it is in `unvalued` with no price.
 *
 * Null for a scan without `book_inputs` (one from before #91): it did not publish what it valued, so nothing is
 * guessed; the site shows it as published.
 * @param {{state: object, scan: object}} args   state.json and a scan output
 */
export function liveBook({ state, scan }) {
  const inputs = scan?.book_inputs;
  if (!state?.portfolio || !state?.marks || !scan?.quotes || !scan?.book || !inputs) return null;
  const result = buildBook({
    portfolio: state.portfolio,
    marks: state.marks,
    positions: state.positions ?? {},
    quotes: scan.quotes,
    fx: scan.fx ?? {},
    previousPrices: inputs.previous_prices ?? {},
    lastGood: inputs.last_good ?? {},
    journal: Object.values(state.journal ?? {}),
    previousCaps: inputs.previous_caps ?? {},
    today: inputs.today,
    sessions: inputs.sessions ?? {},
  });
  return { ...result, changes: holdingChanges({ state, scan }) };
}
