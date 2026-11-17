// Cap alerts (§4.7): a position over its cap, and the tech bucket at or above its cap, worded from a book. Moved here
// from scan/steps/alerts.js (#97, the owner, 2026-10-01) so the site can word them from the live book (lib/book.js
// `liveBook`) with the same function: their titles carry the % of book, which a trade changes. `makeAlert` and
// `round1` moved with them; scan/steps/alerts.js re-exports both.

import { CAP_HYSTERESIS_PCT } from './portfolio.js';
import { bookBasisText } from './values.js';

const LOWER = Object.freeze({ high: 'medium', medium: 'info', info: 'info' });

/** Added to a cap alert's title when its severity was lowered because the book is approximate. */
export const APPROXIMATE_MARKER = ' (severity lowered: approximate book)';

// One decimal, half away from zero on the decimal value, with float noise trimmed first: lib/portfolio.js toOre's own
// convention. (41.65 − 28) / 28 × 100 is 48.74999999999999 in floats, and this gives 48.8, the figure the exact
// decimal rounds to; a plain Math.round gave 48.7 (found 2026-09-23 on a US name's price_vs_level_pct). `+ 0` turns -0 into 0.
export const round1 = (x) => {
  const r = Math.round(Number((Math.abs(x) * 10).toPrecision(12))) / 10;
  return (x < 0 ? -r : r) + 0;
};

/** A complete `alerts[]` entry: anything not given is null, `informational` is false. */
export function makeAlert(fields) {
  return {
    severity: fields.severity,
    kind: fields.kind,
    ticker: fields.ticker,
    level_id: fields.level_id ?? null,
    level_type: fields.level_type ?? null,
    price: fields.price ?? null,
    price_label: fields.price_label ?? null,
    price_date: fields.price_date ?? null,
    level_price: fields.level_price ?? null,
    distance_pct: fields.distance_pct ?? null,
    title: fields.title,
    action: fields.action ?? null,
    condition: fields.condition ?? null,
    decision_needed: fields.decision_needed ?? null,
    informational: fields.informational === true,
    conditional: fields.conditional === true,
  };
}

function lowerIfApproximate(severity, approximate) {
  if (!approximate || LOWER[severity] === severity) return { severity, marker: '' };
  return { severity: LOWER[severity], marker: APPROXIMATE_MARKER };
}

/** `≈8.52% of book (basis 2026-09-14; prices not at the close: ABC.OL from 2026-09-23)`: the NAV date and, since the
 * pre-publish audit (H1, 2026-09-24), every price in the book that is not the session's confirmed close. */
const pctText = (pct, approximate, basisDate, prices) =>
  `${approximate ? '≈' : ''}${pct}% of book (${bookBasisText({ oldest_fund_nav_date: basisDate, unconfirmed_prices: prices })})`;

/** Words an alert title never says (§4.7, Appendix B); a rule that has one is not quoted in a title. */
const TITLE_BANNED = /\b(sell|buy now|confirmed|execute)\b/i;

const noPeriod = (t) => String(t).trim().replace(/\.$/, '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
};

/**
 * Each position's % of book at a previous close, for the held-over cap wording (#94): ticker → `{pct_of_book,
 * pct_approximate, date}`, from that close's scan output as it published it. Empty without one.
 */
export function previousCapPoints(previousScan) {
  if (!previousScan?.positions || !previousScan?.run || previousScan.run.status === 'failed') return {};
  const date = String(previousScan.run.id ?? '').slice(0, 10);
  return Object.fromEntries(Object.entries(previousScan.positions)
    .filter(([, p]) => typeof p?.pct_of_book === 'number')
    .map(([t, p]) => [t, { pct_of_book: p.pct_of_book, pct_approximate: p.pct_approximate === true, date }]));
}

/**
 * A cap state held over by the hysteresis band (`cap_held`), in figures (#94, the owner, 2026-10-01): the % now, the %
 * at the previous close (or null), and the point it clears below. One definition for the alert card's title (worded
 * here, on the site from the live book), the command view's Standing line and the holding badge. Null when not held.
 * @param {{sp: object, previous?: {pct_of_book: number, pct_approximate?: boolean, date: string}|null}} args
 */
export function heldCapWords({ sp, previous = null }) {
  if (!sp?.cap_held || !sp.cap_pct) return null;
  const pct = (p) => `${p.pct_approximate ? '≈' : ''}${p.pct_of_book}%`;
  const then = typeof previous?.pct_of_book === 'number' ? `${pct(previous)} at the ${dayMonth(previous.date)} close` : 'over it at the previous close';
  return { now: pct(sp), then, clears: Number((sp.cap_pct - CAP_HYSTERESIS_PCT).toFixed(2)), band: CAP_HYSTERESIS_PCT };
}

/** The held-over sentence after the ticker: "back under its 8% cap at ≈7.93% of book (basis …), still counted as …". */
export function heldCapPhrase({ sp, previous = null, unconfirmedPrices = [] }) {
  const w = heldCapWords({ sp, previous });
  if (!w) return null;
  const stateWord = sp.cap_state === 'over-by-appreciation' ? 'over by appreciation' : 'over';
  return `back under its ${sp.cap_pct}% cap at ${pctText(sp.pct_of_book, sp.pct_approximate, sp.pct_basis_date, unconfirmedPrices)}, still counted as ${stateWord}: it was ${w.then}, and the state clears only below ${w.clears}% (${w.band}-point band)`;
}

/** The book's cap alerts: `position-over-cap` for each position not clear, `tech-cap` when the bucket is breached. */
export function capAlerts({ bookResult, positions, portfolio, previous = {} }) {
  const alerts = [];
  const { book, positions: math, tech } = bookResult;

  for (const [ticker, p] of Object.entries(math ?? {})) {
    if (p.cap_state === 'clear') continue;
    const text = pctText(p.pct_of_book, p.pct_approximate, p.pct_basis_date, book.unconfirmed_prices);
    const rule = positions?.[ticker]?.caps?.rule ?? null;
    let condition = rule;
    let title;
    let base;   // the severity before the approximate-book step down
    if (p.cap_held) {
      // Back under the cap, but not yet a hysteresis band under it: the last close's state is kept, so a price that
      // moves a hair either side of the cap does not raise and clear the alert day to day (audit #7). Worded with the
      // previous close's % (#94), the same words the Standing line and the holding badge use.
      title = `${ticker} ${heldCapPhrase({ sp: p, previous: previous[ticker] ?? null, unconfirmedPrices: book.unconfirmed_prices })}`;
      base = p.cap_state === 'over' ? 'medium' : 'info';
    } else if (p.cap_state === 'over-by-appreciation') {
      // The position's own rule, not a claim of ours: "not a trim signal" is one position's rule, another's says "no adds". The rule
      // moves into the title, so it is not repeated as the condition (the owner, 2026-09-21, audit #7).
      const quoted = rule && !TITLE_BANNED.test(rule);
      title = `${ticker} is ${text}, over its ${p.cap_pct}% cap by appreciation${quoted ? `; rule: ${noPeriod(rule)}` : ''}`;
      if (quoted) condition = null;
      base = 'info';
    } else if (p.cap_basis === 'cost-basis') {
      const costPct = book.total_nok > 0 ? round1((p.cost_nok / book.total_nok) * 100) : null;
      title = `${ticker} is ${text}, over its ${p.cap_pct}% cap at cost too${costPct === null ? '' : ` (units × GAV is ${costPct}% of book)`}, so not by appreciation`;
      base = 'medium';
    } else {
      title = `${ticker} is ${text}, over its ${p.cap_pct}% cap; units changed without a journal entry`;
      base = 'medium';
    }
    const { severity, marker } = lowerIfApproximate(base, p.pct_approximate);
    alerts.push(makeAlert({ severity, kind: 'position-over-cap', ticker, condition, title: `${title}${marker}` }));
  }

  if (tech?.breached) {
    const { severity, marker } = lowerIfApproximate('high', book.approximate);
    const rule = (portfolio.funds ?? []).filter((f) => f.role === 'capped').flatMap((f) => f.rules ?? []).join(' ');
    alerts.push(makeAlert({
      severity, kind: 'tech-cap', ticker: 'BOOK', condition: rule || null,
      title: `Tech exposure is ${pctText(book.tech_pct, book.approximate, book.oldest_fund_nav_date, book.unconfirmed_prices)}, at or above its ${tech.capPct}% cap${marker}`,
    }));
  }
  return alerts;
}
