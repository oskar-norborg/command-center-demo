// Portfolio math (SPEC.md §4.6). Pure functions: no I/O, no clock, no mutation
// of their inputs. `scan/steps/book.js` assembles them into the `book` and
// `positions` objects of the scan output, and `scan/steps/alerts.js` (T2.6)
// uses the funding gate, fee floor and tech exposure.
//
// Money is computed at full precision, rounded once per component to whole øre
// (`toOre`), and summed as integers, so the parts of a total always add up to
// it exactly. Percentages are published to two decimals (`round2`) but compared
// against thresholds on the unrounded ratio, with float noise removed at the
// sixth decimal.
//
// The missing-input and derived-state cases (no price, no FX, no NAV,
// over-by-appreciation) are defined in SPEC.md §4.6; the code below cites it
// instead of restating it.

import { ISO_DATE, daysBetween, isPositive } from './values.js';

// One definition of each, shared with the browser-safe lib/housekeeping.js (audit #15).
export { ISO_DATE, daysBetween, isPositive };

/** Unit counts are compared with this tolerance (Nordnet shows two decimals). */
export const UNITS_EPSILON = 1e-6;

/**
 * NOK → whole øre, rounding half away from zero on the decimal value. The
 * product is trimmed to 12 significant digits first so binary float noise
 * cannot decide a half-øre case: `3 × 0.835` is 250.49999999999997 in floats
 * but 2.505 NOK, which is 251 øre.
 */
export function toOre(nok) {
  const ore = Math.round(Number((Math.abs(nok) * 100).toPrecision(12)));
  return nok < 0 ? -ore : ore;
}
export const fromOre = (ore) => ore / 100;
export const round2 = (x) => Math.round(x * 100) / 100;
/** Threshold comparisons use this, so a ratio that is exactly at a limit is not pushed across it by float noise. */
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** `units × price × fxRate` in whole øre. `fxRate` is 1 for NOK names. */
export function stockOre({ units, price, fxRate = 1 }) {
  return toOre(units * price * fxRate);
}

/**
 * Fund values and the NAV-driven `approximate` flag (§4.6).
 * A fund without a numeric NAV (`needs-entry`, or no marks entry at all)
 * contributes nothing and makes the book approximate. A NAV older than
 * `staleDays` still counts, at its stale value, and also makes it approximate.
 * @param {object} args
 * @param {{id: string, units: Record<string, number>}[]} args.funds   portfolio.yaml `funds`
 * @param {Record<string, {nav: number|null, as_of: string|null}>} args.navs   marks.yaml `navs`
 * @param {string} args.today   ISO date the ages are measured to
 * @param {number} args.staleDays   `rules.fund_nav_stale_days`
 * @returns {{
 *   values: {id: string, account: string, units: number, nav: number, ore: number}[],
 *   oldestNavDate: string|null,
 *   approximate: boolean,
 *   reasons: string[],
 * }}
 */
export function assessFunds({ funds, navs, today, staleDays }) {
  const values = [];
  const reasons = [];
  let oldestNavDate = null;
  let approximate = false;
  for (const fund of funds) {
    const entry = navs?.[fund.id];
    if (!isPositive(entry?.nav)) {
      approximate = true;
      reasons.push(`${fund.id}: no NAV entered, left out of the book`);
      continue;
    }
    if (ISO_DATE.test(entry.as_of ?? '')) {
      if (oldestNavDate === null || entry.as_of < oldestNavDate) oldestNavDate = entry.as_of;
      const age = daysBetween(entry.as_of, today);
      if (age > staleDays) {
        approximate = true;
        reasons.push(`${fund.id}: NAV is ${age} days old (limit ${staleDays})`);
      }
    } else {
      // A NAV whose age cannot be told is treated as stale rather than fresh.
      approximate = true;
      reasons.push(`${fund.id}: NAV has no date`);
    }
    for (const [account, units] of Object.entries(fund.units)) {
      values.push({ id: fund.id, account, units, nav: entry.nav, ore: toOre(units * entry.nav) });
    }
  }
  return { values, oldestNavDate, approximate, reasons };
}

/** Journal actions that move units (§3.4). A `hold` (§3.4a) and an `opening` balance (§3.4b) are not trades. */
export const TRADE_ACTIONS = Object.freeze(['buy', 'add', 'trim', 'sell']);

/** True for a trade entry: the only kind the cap replay, the no-journal test and `state-quiet` count. */
export function isTradeEntry(entry) {
  return TRADE_ACTIONS.includes(entry?.action);
}

/**
 * Units a ticker's journal accounts for (§4.6 rule (a), §3.4b): its opening balance entry's `units`, if it has one,
 * plus buys and adds minus trims and sells dated after it. With no opening entry the replay starts from zero. Hold
 * entries count nothing. A trade dated on or before the opening entry is already inside the opening balance.
 * @param {{action: string, units?: number, date?: string}[]} entries   one ticker's entries
 */
export function journalUnits(entries) {
  const opening = entries.find((e) => e?.action === 'opening') ?? null;
  let sum = opening ? opening.units : 0;
  for (const entry of entries) {
    if (!isTradeEntry(entry)) continue;
    if (opening?.date && entry.date && entry.date <= opening.date) continue;
    sum += (entry.action === 'buy' || entry.action === 'add' ? 1 : -1) * entry.units;
  }
  return sum;
}

/**
 * `clear | over-by-appreciation | over` for one position (§4.6, rule (a)).
 * `over` needs `pctOfBook` strictly above the cap. The comparison is not made on
 * the published two-decimal figure (8.004 is over an 8 cap though it displays as
 * 8.00), only with float noise removed at the sixth decimal.
 * An over-cap position with no trade entry for the ticker is judged on its cost-basis share (below). With trade
 * entries, replaying them from the opening balance (or zero) must give exactly the units held now for the state to be
 * `over-by-appreciation`; any mismatch means units moved without a record: `over`. Hold and opening entries alone are
 * not a journal for this test (§3.4a, §3.4b).
 * @param {object} args
 * @param {number} args.pctOfBook
 * @param {number|null|undefined} args.capPct   `caps.max_pct_of_book`, if any
 * @param {number} args.units   units held now
 * @param {{action: string, units?: number, date?: string}[]} args.journalEntries   this ticker's entries only, any kind
 */
export function deriveCapState({ pctOfBook, capPct, units, journalEntries, costPct }) {
  if (!isPositive(capPct) || !(round6(pctOfBook) > capPct)) return 'clear';
  // No trade to replay: appreciation only if the position was within its cap at cost (units × GAV as a share of the
  // book), so a position bought over its cap is never called appreciation (the owner, 2026-09-21, audit #7). Without a
  // cost share to check, the old reading stands.
  if (!journalEntries.some(isTradeEntry)) return isPositive(costPct) && round6(costPct) > capPct ? 'over' : 'over-by-appreciation';
  return Math.abs(journalUnits(journalEntries) - units) < UNITS_EPSILON ? 'over-by-appreciation' : 'over';
}

/**
 * How far below its cap a position must fall, in percentage points of book, before a cap state is dropped. A position
 * that was over its cap at the last close keeps that state until it is this far under, so a price that moves a hair
 * either side of the cap does not raise and clear the alert from one day to the next (the owner, 2026-09-21, audit #7).
 * The number is this code's default, not the owner's: he asked for hysteresis on small moves, not for its size.
 */
export const CAP_HYSTERESIS_PCT = 0.25;

/**
 * The cap state held over from the last close, or null. Held only while the position is back at or under its cap but
 * not yet `CAP_HYSTERESIS_PCT` under it; crossing above the cap needs no band, and a position that was clear last time
 * is never held.
 * @param {object} args
 * @param {number} args.pctOfBook
 * @param {number|null|undefined} args.capPct
 * @param {string|null|undefined} args.previousState   the previous close's `cap_state` for this ticker
 * @returns {'over'|'over-by-appreciation'|null}
 */
export function heldCapState({ pctOfBook, capPct, previousState }) {
  if (!isPositive(capPct)) return null;
  if (previousState !== 'over' && previousState !== 'over-by-appreciation') return null;
  const pct = round6(pctOfBook);
  return pct <= capPct && pct > round6(capPct - CAP_HYSTERESIS_PCT) ? previousState : null;
}

/**
 * Tech-bucket exposure (§4.6). Members are fund ids or position tickers; every
 * account's holding of a member fund counts. A breach is `pct >= capPct`
 * ("alert at ≥ 45%"), compared to the sixth decimal, not on the published figure.
 * @param {object} args
 * @param {string[]} args.members   `rules.tech_bucket_members`
 * @param {Record<string, number>} args.fundOre   fund id → value across accounts, øre
 * @param {Record<string, number>} args.positionOre   ticker → value, øre (valued positions only)
 * @param {number} args.totalOre
 * @param {number} args.capPct   `rules.tech_cap_pct`
 * @returns {{ore: number, pct: number, capPct: number, breached: boolean}}
 */
export function techExposure({ members, fundOre, positionOre, totalOre, capPct }) {
  let ore = 0;
  for (const member of members) ore += fundOre[member] ?? positionOre[member] ?? 0;
  const pct = totalOre > 0 ? (ore / totalOre) * 100 : 0;
  return { ore, pct, capPct, breached: round6(pct) >= capPct };
}

/**
 * The account a name is bought into: a position's `account`, or a watchlist
 * entry's `target_account`. Null when the file names none.
 */
export function targetAccountOf(entry) {
  return entry?.account ?? entry?.target_account ?? null;
}

/**
 * The funding gate (§4.6): a `buy` or `add` level hit on a name targeting an account whose cash is below its
 * `cash_floor` is informational. Today only ASK has a floor, which is exactly the spec's "ASK-targeted name while ASK
 * cash < floor"; the floor is read from `portfolio.accounts` rather than hard-coded. Cash equal to the floor is not
 * below it.
 *
 * Returns facts, not wording (#92, the owner, 2026-10-01): the cash date used to be baked into the scan's alert title
 * (" (ASK below floor per marks.yaml cash of 2026-09-17)"), so the site kept showing the scan-time cash after a trade
 * changed it. The site now composes that text from the current state, with `fundingNote`.
 * @param {object} args
 * @param {string} args.levelType
 * @param {string|null} args.account   see `targetAccountOf`
 * @param {number|null|undefined} args.cash   that account's cash, NOK
 * @param {string|null|undefined} [args.cashAsOf]   the date of that cash entry in marks.yaml
 * @param {Record<string, {cash_floor?: number}>} args.accounts   portfolio.yaml `accounts`
 * @returns {{informational: boolean, account?: string, cash?: number, cashAsOf?: string|null, floor?: number}}
 */
export function fundingGate({ levelType, account, cash, cashAsOf, accounts }) {
  const none = { informational: false };
  if (levelType !== 'buy' && levelType !== 'add') return none;
  const floor = accounts?.[account]?.cash_floor;
  if (typeof floor !== 'number' || typeof cash !== 'number') return none;
  if (!(cash < floor)) return none;
  return { informational: true, account, cash, cashAsOf: ISO_DATE.test(cashAsOf ?? '') ? cashAsOf : null, floor };
}

/** The words for an informational gate: "informational: ASK below its 10000 floor (cash 9054 as of 2026-09-17)". */
export function fundingNote(gate) {
  if (!gate?.informational) return null;
  return `informational: ${gate.account} below its ${gate.floor} floor (cash ${gate.cash}${gate.cashAsOf ? ` as of ${gate.cashAsOf}` : ''})`;
}

/** Level types whose hit is high severity (an unresolved level's hit is too). */
export const HIGH_WHEN_HIT = Object.freeze(new Set(['exit', 'invalidation', 'trim']));

/**
 * A level alert's severity and whether it is informational, given the funding gate. One definition for the scan, which
 * writes the alert, and the site, which re-judges the gate against the current cash (#92).
 * @param {{hit: boolean, levelType: string, levelStatus?: string, gate: {informational: boolean}}} args
 * @returns {{severity: 'high'|'medium'|'info', informational: boolean}}
 */
export function levelAlertSeverity({ hit, levelType, levelStatus, gate }) {
  if (hit && gate?.informational) return { severity: 'info', informational: true };
  const high = hit && (levelStatus === 'unresolved' || HIGH_WHEN_HIT.has(levelType));
  return { severity: high ? 'high' : 'medium', informational: false };
}

/**
 * Fee-floor warning (§4.6): a suggested buy size below `fee_floor_per_buy_nok`.
 * No suggested size means nothing to warn about. A size equal to the floor is fine.
 * @param {object} args
 * @param {{nok: number, approximate?: boolean}|null|undefined} args.suggestedSize   watchlist `suggested_size`
 * @param {number|null|undefined} args.floor   `rules.fee_floor_per_buy_nok`
 * @returns {{size_nok: number, floor_nok: number, approximate: boolean}|null}
 */
export function feeFloorWarning({ suggestedSize, floor }) {
  if (typeof suggestedSize?.nok !== 'number' || typeof floor !== 'number') return null;
  if (suggestedSize.nok >= floor) return null;
  return { size_nok: suggestedSize.nok, floor_nok: floor, approximate: suggestedSize.approximate === true };
}

/**
 * Day change on stocks and cash (§4.6, `day_change_scope: stocks-only`).
 * Cash does not move, so it only enters the percentage's base. A position with
 * no baseline (`prevOre: null`) contributes no change and counts at its current
 * value in the base. When no position has a baseline there is nothing to
 * measure and the answer is `null`, not zero: "0 NOK (0.0%)" reads as a flat
 * day (found on the first shadow run, a Saturday with both exchanges closed).
 * @param {{nowOre: number, prevOre: number|null}[]} rows   valued stocks
 * @param {number} cashOre
 * @returns {{changeOre: number, pct: number}|null}
 */
export function dayChange(rows, cashOre) {
  if (!rows.some((row) => row.prevOre !== null && row.prevOre !== undefined)) return null;
  let changeOre = 0;
  let baseOre = cashOre;
  for (const row of rows) {
    const prev = row.prevOre ?? row.nowOre;
    changeOre += row.nowOre - prev;
    baseOre += prev;
  }
  return { changeOre, pct: baseOre > 0 ? round2((changeOre / baseOre) * 100) : 0 };
}

/**
 * One row per fund in `portfolio.yaml` (§4.6, 2026-09-23, the owner: "calculated in the scan"): its value across accounts
 * (`assessFunds`' own øre, so the rows add up to `funds_nok` exactly), its share of the book, and its P&L against GAV.
 * Cost is units × GAV per account, from `portfolio.yaml`; it is null, and so is the P&L, unless every account holding
 * the fund has a GAV, since a partial cost would understate it. A fund `assessFunds` left out (no NAV) has a null value
 * and a null share: it is listed so nothing is silently dropped, never valued at zero.
 * @param {object} args
 * @param {{id: string, units: Record<string, number>, gav?: Record<string, number>}[]} args.funds   portfolio.yaml `funds`
 * @param {Record<string, {nav: number|null, as_of: string|null}>} args.navs   marks.yaml `navs`
 * @param {{id: string, ore: number}[]} args.values   `assessFunds(...).values`
 * @param {number} args.totalOre   the book total, øre
 * @returns {{id: string, valueOre: number|null, costOre: number|null, pctOfBook: number|null, nav: number|null, navAsOf: string|null}[]}
 */
export function fundHoldings({ funds, navs, values, totalOre }) {
  return funds.map((fund) => {
    const rows = values.filter((v) => v.id === fund.id);
    const entry = navs?.[fund.id];
    const nav = isPositive(entry?.nav) ? entry.nav : null;
    const navAsOf = ISO_DATE.test(entry?.as_of ?? '') ? entry.as_of : null;
    if (rows.length === 0) return { id: fund.id, valueOre: null, costOre: null, pctOfBook: null, nav, navAsOf };
    const valueOre = rows.reduce((a, r) => a + r.ore, 0);
    const held = Object.entries(fund.units ?? {});
    const costKnown = held.length > 0 && held.every(([account]) => isPositive(fund.gav?.[account]));
    const costOre = costKnown ? held.reduce((a, [account, units]) => a + toOre(units * fund.gav[account]), 0) : null;
    return { id: fund.id, valueOre, costOre, pctOfBook: totalOre > 0 ? (valueOre / totalOre) * 100 : null, nav, navAsOf };
  });
}

/**
 * P&L against cost for a set of holdings, in øre: `{costOre, pnlOre, pct}`, or null when there is nothing to measure or
 * any holding's value or cost is unknown (a partial sum would read as the whole). `pct` is to two decimals.
 * @param {{valueOre: number|null, costOre: number|null}[]} rows
 */
export function pnlSummary(rows) {
  if (rows.length === 0 || rows.some((r) => !Number.isInteger(r.valueOre) || !Number.isInteger(r.costOre))) return null;
  const costOre = rows.reduce((a, r) => a + r.costOre, 0);
  const pnlOre = rows.reduce((a, r) => a + r.valueOre - r.costOre, 0);
  return { costOre, pnlOre, pct: costOre > 0 ? round2((pnlOre / costOre) * 100) : 0 };
}
