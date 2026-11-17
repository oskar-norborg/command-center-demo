// The command view's numbers from the current state at the scan's prices (#91, #92, the owner, 2026-10-01).
//
// A scan values the units, GAV and cash it read when it ran. After a trade is merged, state.json has moved on and the
// scan has not, so the page used to show the old holdings next to the new cash, with no marker. Here the book is
// recomputed with the scan's own function (lib/book.js `liveBook`, one definition) from the current state and the
// scan's quotes, FX and other inputs, keeping every label and `≈` rule. Level states, `no_adds` and everything else
// that depends on the price alone stay as the scan published them.
//
// Level alerts on a buy or add are re-judged against the current cash with the scan's own gate (lib/portfolio.js
// `fundingGate`, `levelAlertSeverity`), and the funding wording is composed here from the current state, never taken
// from the scan's title (which, before #92, carried the cash date the scan saw).

import { liveBook } from '../lib/book.js';
import { capAlerts, previousCapPoints } from '../lib/cap-alerts.js';
import { fundingGate, fundingNote, levelAlertSeverity, targetAccountOf } from '../lib/portfolio.js';

/** The book's own fields on a scan position: replaced by the live book's, never mixed with them. */
const BOOK_FIELDS = ['value_nok', 'cost_nok', 'pnl_nok', 'pnl_pct', 'day_change_nok', 'pct_of_book', 'pct_basis_date',
  'pct_approximate', 'priced', 'cap_pct', 'cap_state', 'cap_held', 'cap_basis'];

/** Alert kinds worded from the book's % (lib/cap-alerts.js): rebuilt from the live book, never shown as the scan's. */
const BOOK_ALERT_KINDS = new Set(['position-over-cap', 'tech-cap']);

/** The funding suffix scans before #92 appended to a gated alert's title. */
const LEGACY_FUNDING_SUFFIX = / \([A-Z]+ below floor per marks\.yaml cash(?: of \d{4}-\d{2}-\d{2})?\)$/;

/**
 * Level alerts with their funding gate re-judged against the current cash, and `funding_note` composed from it. Every
 * other alert keeps the scan's severity; every title loses a legacy funding suffix.
 */
export function regateAlerts(alerts, state) {
  return (alerts ?? []).map((a) => {
    const title = typeof a.title === 'string' ? a.title.replace(LEGACY_FUNDING_SUFFIX, '') : a.title;
    if (!a.level_id || (a.level_type !== 'buy' && a.level_type !== 'add')) return { ...a, title, funding_note: null };
    const entry = state?.positions?.[a.ticker] ?? state?.watchlist?.[a.ticker] ?? null;
    const level = (entry?.levels ?? []).find((l) => l.id === a.level_id) ?? null;
    const account = targetAccountOf(entry);
    const cash = state?.marks?.cash?.[account];
    const hit = a.kind === 'hit';
    const gate = hit
      ? fundingGate({ levelType: a.level_type, account, cash: cash?.nok, cashAsOf: cash?.as_of, accounts: state?.portfolio?.accounts })
      : { informational: false };
    const { severity, informational } = levelAlertSeverity({ hit, levelType: a.level_type, levelStatus: level?.status, gate });
    return { ...a, title, severity, informational, funding_note: fundingNote(gate) };
  });
}

/**
 * The scan as the command view should read it: book, positions and funds from the current state at this scan's prices,
 * alerts re-gated (a held-over cap alert worded with `prevClose`'s %, #94). `live.changes` lists what moved since the scan, `live.unvalued` the names the book could not
 * value. A missing or failed scan is returned as it is; one without `book_inputs` (from before #91) keeps its own book.
 */
export function withLiveState(scan, state, prevClose = null) {
  if (!scan?.run || scan.run.status === 'failed' || !state) return scan;
  // The funding gate needs only the current state, so every scan's alerts are re-judged (#92).
  const alerts = regateAlerts(scan.alerts, state);
  const lb = liveBook({ state, scan });
  // A scan from before #91 has no `book_inputs`: its book is shown as published, nothing guessed. The next close
  // replaces it.
  if (!lb) return { ...scan, alerts };
  const positions = {};
  for (const [t, p] of Object.entries(lb.positions)) {
    const published = { ...(scan.positions?.[t] ?? {}) };
    for (const f of BOOK_FIELDS) delete published[f];
    // A name held since the scan has its level states under the scan's watchlist section.
    positions[t] = { ...published, levels: published.levels ?? scan.watchlist?.[t]?.levels ?? [], ...p };
  }
  // The cap alerts carry the % of book in their titles: worded again from the live book with the scan's own function.
  const liveAlerts = [...alerts.filter((a) => !BOOK_ALERT_KINDS.has(a.kind)), ...capAlerts({ bookResult: lb, positions: state.positions, portfolio: state.portfolio, previous: previousCapPoints(prevClose) })];
  return {
    ...scan,
    book: lb.book,
    positions,
    funds: lb.funds,
    alerts: liveAlerts,
    live: { changes: lb.changes, unvalued: lb.unvalued, scanBook: scan.book },
  };
}

/** One line for each change since the scan: `ABC.OL units 40 → 45`, `XYZ.OL bought`, `ASK cash 12000 → 10950.5`. */
export function changeWords(changes, fmt = (n) => String(n)) {
  return (changes ?? []).map((c) => {
    if (c.kind === 'bought') return `${c.key} bought`;
    if (c.kind === 'sold') return `${c.key} sold`;
    const what = c.kind === 'cash' ? 'cash' : c.kind === 'gav' ? 'GAV' : 'units';
    return `${c.key} ${what} ${c.from === null ? '—' : fmt(c.from)} → ${c.to === null ? '—' : fmt(c.to)}`;
  });
}
