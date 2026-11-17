// The command view's brief (SPEC.md §5.3, decided 2026-09-23: option B with option A's holding rows): what is
// different since the previous close, read from two scan outputs the page already has. Pure, no DOM and no clock.
// Nothing here computes a money figure: every number is copied from a scan file. Only states and timestamps are
// compared, and distances are worded from the figure the scan published.
import { shortDate } from '../data.js';

/** Short type words for a level in running text, as the command view has always used them. */
export const TYPE_WORD = Object.freeze({ buy: 'buy', add: 'add', trim: 'trim', exit: 'exit', invalidation: 'inv', watchpoint: 'watch' });

/** A level's price as text: `420`, a zone `270–280`, or an unresolved level's candidates `23 / 28`. */
export function levelPriceText(level) {
  if (level?.price != null) return String(level.price);
  if (level?.price_low != null) return `${level.price_low}–${level.price_high}`;
  return (level?.candidates ?? []).map((c) => c.price).join(' / ');
}

/**
 * Where the price is against a level, in words: `7.8% below`, `at`, or `inside` (a zone). The figure is the scan's own
 * (2026-09-23, the watchlist-strip fix): the level state's `price_vs_level_pct`, else the matching alert's `distance_pct`, the
 * same figure its title prints. A scan from before 23 Sep carries neither on a level with no alert; only then is it
 * re-derived from the level state's rounded `distance_pct` (the old way, which could differ by 0.1). Null with no
 * distance at all.
 * @param {{distance_pct?: number|null, price_vs_level_pct?: number}|null|undefined} levelState
 * @param {{distance_pct?: number|null}|null} [alert]
 * @param {object} [level]   the level, to say `inside` for a zone
 */
export function distanceWords(levelState, alert = null, level = null) {
  let pct = null;
  if (typeof levelState?.price_vs_level_pct === 'number') pct = levelState.price_vs_level_pct;
  else if (typeof alert?.distance_pct === 'number') pct = alert.distance_pct;
  else if (typeof levelState?.distance_pct === 'number') {
    const d = levelState.distance_pct;
    if (d === 0) return level?.price_low != null ? 'inside' : 'at';
    pct = Math.round((-d / (1 + d / 100)) * 10) / 10;
  }
  if (pct === null) return null;
  if (pct === 0) return level?.price_low != null ? 'inside' : 'at';
  return `${Math.abs(pct).toFixed(1)}% ${pct > 0 ? 'above' : 'below'}`;
}

/** `7.8% below buy 138`, `inside watch 270–280`, or just `buy 138` when there is no distance. */
export function levelWords(level, levelState, alert = null) {
  const type = TYPE_WORD[level.type] ?? level.type;
  const words = distanceWords(levelState, alert, level);
  return words ? `${words} ${type} ${levelPriceText(level)}` : `${type} ${levelPriceText(level)}`;
}

/** The level state nearest its price, or null when none has a distance. */
export function nearestLevelState(levelStates) {
  const withDistance = (levelStates ?? []).filter((l) => typeof l.distance_pct === 'number');
  return withDistance.sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0] ?? null;
}

/** Headline and earnings alerts are not triggers (SPEC.md §4.9); every other alert is. */
export const isTrigger = (a) => !['headline', 'earnings'].includes(a.kind);

export const alertKey = (a) => `${a.kind}|${a.ticker}|${a.level_id ?? ''}`;

const SEVERITY = { high: 0, medium: 1, info: 2 };
export const bySeverity = (a, b) => (SEVERITY[a.severity] ?? 3) - (SEVERITY[b.severity] ?? 3);

/**
 * What changed between `previous` (the close before) and `current` (the close the page's levels come from):
 * - `capChanges`: positions whose `cap_state` changed, with both shares of the book as published;
 * - `stateChanges`: levels whose state changed (`clear → near`, `hit → clear`, `clear → not-evaluated`...);
 * - `added` / `cleared`: trigger alerts present now and not before, and the reverse;
 * - `standing`: trigger alerts present at both closes.
 * Null when there is no previous close to compare with.
 */
export function closeChanges(current, previous, state) {
  if (!current || !previous?.run) return null;
  const capChanges = [];
  for (const [ticker, p] of Object.entries(current.positions ?? {})) {
    const was = previous.positions?.[ticker];
    if (was && was.cap_state !== p.cap_state) {
      capChanges.push({ ticker, from: was.cap_state, to: p.cap_state, pctFrom: was.pct_of_book, pctTo: p.pct_of_book, capPct: p.cap_pct, basis: p.pct_basis_date, approximate: p.pct_approximate === true, rule: state?.positions?.[ticker]?.caps?.rule ?? null });
    }
  }
  const stateChanges = [];
  for (const section of ['positions', 'watchlist']) {
    for (const [ticker, entry] of Object.entries(current[section] ?? {})) {
      for (const ls of entry.levels ?? []) {
        const was = previous[section]?.[ticker]?.levels?.find((l) => l.id === ls.id);
        if (was && was.state !== ls.state) {
          const level = state?.[section]?.[ticker]?.levels?.find((l) => l.id === ls.id) ?? null;
          stateChanges.push({ section, ticker, level, from: was.state, to: ls.state, levelState: ls, reason: ls.reason ?? null });
        }
      }
    }
  }
  const before = new Map((previous.alerts ?? []).filter(isTrigger).map((a) => [alertKey(a), a]));
  const now = (current.alerts ?? []).filter(isTrigger);
  const nowKeys = new Set(now.map(alertKey));
  return {
    previousRunId: previous.run.id,
    previousDate: previous.run.id.slice(0, 10),
    capChanges,
    stateChanges,
    added: now.filter((a) => !before.has(alertKey(a))),
    cleared: [...before.values()].filter((a) => !nowKeys.has(alertKey(a))),
    standing: now.filter((a) => before.has(alertKey(a))),
    previousAlert: (a) => before.get(alertKey(a)) ?? null,
  };
}

/** The `run.sessions` key a name's quotes are judged against: lib/labels.js `calendarExchange`'s own mapping. */
export const sessionKeyOf = (exchange) => (exchange === 'OSE' ? 'OSE' : 'NYSE');

/**
 * Headlines on held names published after the close that priced them. The close time is the scan's own
 * (`run.sessions[x].close_utc`, 2026-09-23: market hours come from the scan, never the browser). A scan written before
 * that field existed has no close time; then the cut is the previous close run's finish ("since the 22 Sep close
 * run"), and with neither there is nothing to say. `high` holds the `news_priority: high` names, whose headlines are
 * listed; `others` the rest, as counts. Each list is newest first.
 * @returns {{mode: 'after-close'|'since-previous', since: string|null, high: {ticker: string, items: object[], total: number}[], others: {ticker: string, count: number}[]}|null}
 */
export function heldNewsAfterClose({ scan, state, previous }) {
  if (!scan?.news) return null;
  const sessions = scan.run?.sessions ?? {};
  const closeOf = (ticker) => sessions[sessionKeyOf(state?.positions?.[ticker]?.exchange)]?.close_utc ?? null;
  const anyClose = Object.values(sessions).some((s) => s?.close_utc);
  const mode = anyClose ? 'after-close' : previous?.run?.finished_utc ? 'since-previous' : null;
  if (!mode) return null;
  const cut = (ticker) => (mode === 'after-close' ? closeOf(ticker) : previous.run.finished_utc);
  const high = [];
  const others = [];
  for (const ticker of Object.keys(state?.positions ?? {})) {
    const since = cut(ticker);
    if (!since) continue;
    const all = scan.news[ticker] ?? [];
    const after = all.filter((n) => Date.parse(n.published) > Date.parse(since)).sort((a, b) => b.published.localeCompare(a.published));
    if (after.length === 0) continue;
    if (state.positions[ticker].news_priority === 'high') high.push({ ticker, items: after, total: all.length, since });
    else others.push({ ticker, count: after.length, since });
  }
  others.sort((a, b) => b.count - a.count || a.ticker.localeCompare(b.ticker));
  return { mode, since: mode === 'since-previous' ? previous.run.finished_utc : null, high, others };
}

/** Newest first, folding a headline whose first five words repeat one already kept (one story, many outlets). */
export function pickHeadlines(items, n) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item.title).toLowerCase().replace(/[^\p{L}\p{N}$ ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === n) break;
  }
  return out;
}

/**
 * Why a quote's price is not its exchange's confirmed close for the session this scan valued (`run.sessions[x].date`,
 * the last completed session), in a few words for a Moves row or a holding's change column, or null when it is
 * (pre-publish audit H1, 2026-09-24). The same test the scan applies to the book's `unconfirmed_prices`, read here for
 * any quote so the watchlist's moves are marked too: `price from 23 Sep`, `undated price`, `intraday print, 24 Sep`,
 * `unconfirmed, 24 Sep`. Nothing is computed: a label and two dates are compared.
 * @param {object|null} scan
 * @param {string} ticker
 * @param {string} [exchange]   the file's `exchange` (OSE, NYSE, NASDAQ)
 */
export function priceNote(scan, ticker, exchange) {
  const q = scan?.quotes?.[ticker];
  if (!q || typeof q.price !== 'number') return null;
  const session = scan?.run?.sessions?.[sessionKeyOf(exchange)]?.date ?? null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.session_date ?? '') ? q.session_date : null;
  if (q.label === 'confirmed close' && date !== null && date === session) return null;
  if (date === null) return 'undated price';
  if (session && date < session) return `price from ${shortDate(date)}`;
  if (q.label === 'intraday print') return `intraday print, ${shortDate(date)}`;
  return `unconfirmed, ${shortDate(date)}`;
}

/**
 * Every priced name's day move, held names with their NOK part of the book's day change (the scan's own figure). A move
 * whose price is not the session's confirmed close carries `note` (`priceNote`), and the page shows it with `≈`.
 */
export function moves(scan, state) {
  const rows = [];
  for (const [ticker, q] of Object.entries(scan?.quotes ?? {})) {
    if (typeof q?.change_pct !== 'number' || typeof q.price !== 'number') continue;
    const held = Boolean(state?.positions?.[ticker]);
    const nok = held && typeof scan.positions?.[ticker]?.day_change_nok === 'number' ? scan.positions[ticker].day_change_nok : null;
    const exchange = (state?.positions?.[ticker] ?? state?.watchlist?.[ticker])?.exchange;
    rows.push({ ticker, pct: q.change_pct, nok, held, note: priceNote(scan, ticker, exchange) });
  }
  const held = rows.filter((r) => r.held).sort((a, b) => (a.nok !== null && b.nok !== null ? Math.abs(b.nok) - Math.abs(a.nok) : Math.abs(b.pct) - Math.abs(a.pct)));
  const watch = rows.filter((r) => !r.held).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return { held, watch, maxAbs: Math.max(0, ...rows.map((r) => Math.abs(r.pct))) };
}
