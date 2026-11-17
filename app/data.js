// Data loading — SPEC.md §5.1. Fetches the three build-output JSON files
// once, with cache: no-store, and re-validates before anything trusts a
// price: label must be one of the four allowed strings and price must be a
// positive number. Values are never computed client-side from a missing
// quote. One exception, by design (#91, the owner, 2026-10-01): main.js recomputes
// the book from the current state at the scan's prices with the scan's own
// function (live-state.js, lib/book.js), so a trade merged after the scan shows
// at once; nothing is priced that the scan did not price.
const ALLOWED_LABELS = Object.freeze([
  'confirmed close',
  'intraday print',
  'last close, unconfirmed',
  'fetch failed',
]);

/** `{value, fromCache, date}` — `fromCache` is set by sw.js's `x-command-center-cache` header (T3.5b) when the
 * service worker served this file from its offline cache rather than the network; `date` is that response's own
 * `Date` header (when it was originally fetched, i.e. cached), for the "cached <time>" banner. */
async function fetchJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return { value: null, fromCache: false, date: null };
    // `res.headers` is optional here (not just defensive-for-its-own-sake): several tests' fetch stand-ins return
    // a plain {ok, json} object with no `headers` at all, same as a fetch() they don't care to fully mock —
    // reading a header they never set is "there is none", not a crash.
    return { value: await res.json(), fromCache: res.headers?.get('x-command-center-cache') === 'hit', date: res.headers?.get('date') ?? null };
  } catch {
    return { value: null, fromCache: false, date: null };
  }
}

/** Loads dist/data/{state,scan,findings,config,last-close,prev-close,history,outcomes}.json. Any of them may be null.
 * `outcomes` is the journal's outcome prices, keyed by entry id (scripts/build-findings.js `buildOutcomes`, T4.1).
 * `prevClose` is the close before the one the page's levels come from and `history` the book at every close
 * (scripts/build-history.js, 2026-09-23), both for the command view. `cachedAt` is set when any file was served from
 * the offline cache (T3.5b) — the newest such file's own fetch `Date`, for the "cached <time>" banner; null when
 * everything came from the network. */
export async function loadData() {
  const results = await Promise.all([
    fetchJson('data/state.json'),
    fetchJson('data/scan.json'),
    fetchJson('data/findings.json'),
    fetchJson('data/config.json'),
    fetchJson('data/last-close.json'),
    fetchJson('data/prev-close.json'),
    fetchJson('data/history.json'),
    fetchJson('data/outcomes.json'),
    fetchJson('data/series.json'),
  ]);
  const [state, scan, findings, config, lastClose, prevClose, history, outcomes, series] = results.map((r) => r.value);
  const cachedDates = results.filter((r) => r.fromCache && r.date).map((r) => Date.parse(r.date)).filter((t) => !Number.isNaN(t));
  const cachedAt = cachedDates.length ? new Date(Math.max(...cachedDates)).toISOString() : null;
  return { state, scan, findings, config, lastClose, prevClose, history, outcomes, series, cachedAt };
}

/** No scan file, or the run itself failed outright (SPEC.md §5.1). */
export function hasScan(scan) {
  return Boolean(scan && scan.run && scan.run.status !== 'failed');
}

/** A quote object, only if its label and price both pass re-validation. */
export function validQuote(quote) {
  if (!quote) return null;
  if (!ALLOWED_LABELS.includes(quote.label)) return null;
  if (typeof quote.price !== 'number' || !(quote.price > 0)) return null;
  return quote;
}

/** The re-validated quote for one ticker, or null if there's no usable scan/quote. */
export function quoteFor(scan, ticker) {
  if (!hasScan(scan)) return null;
  return validQuote(scan.quotes?.[ticker]);
}

export function money(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
}

export function signed(n, suffix = '') {
  if (typeof n !== 'number') return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}${suffix}`;
}

/**
 * A level-state `distance_pct` (SPEC.md §4.7, `(level − price) / price`) worded the same way a trigger's
 * own distance is (§4.7's title pattern, `(price − level) / level`, positive above the level): the two
 * conventions measure the same gap from opposite denominators, so the magnitude differs and is recomputed
 * here rather than just relabelled. Returns `"4.3% below"` (append the level price), or `"at"` exactly at
 * the level, or null with no numeric distance.
 */
export function levelDistanceWords(distancePct) {
  if (typeof distancePct !== 'number') return null;
  if (distancePct === 0) return 'at';
  const raw = -distancePct / (1 + distancePct / 100);
  const pct = Math.round(raw * 10) / 10;
  return `${Math.abs(pct).toFixed(1)}% ${pct >= 0 ? 'above' : 'below'}`;
}

// --- display models (T2.11) ---------------------------------------------
// The site only displays what the scan computed: nothing below derives a price
// or a level state, it only decides what to show and how to word it.

/** One glyph per quote label, shown next to every price so the label is never lost. */
export const LABEL_GLYPH = Object.freeze({
  'confirmed close': '●',
  'intraday print': '◐',
  'last close, unconfirmed': '○',
  'fetch failed': '✕',
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-17` -> `17 Sep` (null or malformed -> ''). */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
}

/**
 * What to show for one ticker's quote (SPEC.md §4.4, §4.5, §5.1, Appendix B):
 *  - `price`: a validated price with its label and session date;
 *  - `range`: two sources disagreed, so the range and no single number;
 *  - `unavailable`: no price, with the reason and the last good price and its date;
 *  - `no-scan`: there is no scan at all.
 * A price is never shown with the `fetch failed` label, and never from a quote that fails re-validation.
 */
export function quoteView(scan, ticker) {
  if (!hasScan(scan)) return { kind: 'no-scan' };
  const q = scan.quotes?.[ticker];
  if (!q) return { kind: 'unavailable', reason: 'no quote in this scan', last_good: null, label: null };
  // Appendix B: never a price with the `fetch failed` label, whatever the file says.
  if (q.label !== 'fetch failed' && validQuote(q)) {
    return {
      kind: 'price', price: q.price, currency: q.currency, label: q.label, session_date: q.session_date ?? null,
      change_pct: q.change_pct ?? null, change_basis: q.change_basis ?? null, prev_close: q.prev_close ?? null,
    };
  }
  if (typeof q.price_low === 'number' && typeof q.price_high === 'number') {
    return { kind: 'range', low: q.price_low, high: q.price_high, currency: q.currency, label: ALLOWED_LABELS.includes(q.label) ? q.label : null };
  }
  const label = ALLOWED_LABELS.includes(q.label) ? q.label : null;
  return {
    kind: 'unavailable',
    reason: q.failure_reason ?? (label === 'fetch failed' ? 'no usable source' : 'the price failed validation'),
    last_good: q.last_good ?? null,
    label,
  };
}

/** `the price and its currency`, or `—`. */
export function priceText(view) {
  if (view.kind === 'price') return `${view.price} ${view.currency}`;
  if (view.kind === 'range') return `${view.low}–${view.high} ${view.currency}`;
  return '—';
}

/** `vs prev close` / `vs last scan` for a quote's `change_basis`. */
export function changeBasisText(basis) {
  return basis === 'prev-session' ? 'vs prev close' : basis === 'last-scan' ? 'vs last scan' : '';
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The ET calendar date (`YYYY-MM-DD`) at `nowMs`: the day the scan counts ages to, so the site's checks agree with it. */
export function todayEt(nowMs) {
  return ET_DATE.format(new Date(nowMs));
}

/** Whole days from `iso` to `nowMs` (UTC), or null for a malformed date. */
export function daysSince(iso, nowMs) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor((nowMs - t) / 86_400_000);
}

// --- morning runs (T2.13) -----------------------------------------------
// A morning scan evaluates no levels (SPEC.md §4.1 item 5): its level lists are
// empty and it raises no level alerts. While it is the newest scan, level states
// and triggers are read from the last close instead, and labelled as such.

/** True when the newest scan is a morning run. */
export const isMorning = (scan) => hasScan(scan) && scan.run.type === 'morning';

/**
 * The scan to read level states and level alerts from: the scan itself, or the last close when the newest scan is a
 * morning run. A morning run with no earlier close has no level data to show: null.
 */
export function levelScan(scan, lastClose) {
  if (!isMorning(scan)) return scan;
  return hasScan(lastClose) ? lastClose : null;
}

/** The date of the close the levels come from when they are not the newest scan's own, else null. */
export function levelsFromClose(scan, lastClose) {
  return isMorning(scan) && hasScan(lastClose) ? lastClose.run.id.slice(0, 10) : null;
}

// --- levels that could not be checked (audit 2026-09-19, #2) ---------------------
// `clear` means "checked, and not near". A level the scan could not judge (failed,
// withheld, undated, intraday or wrong-session price) is `not-evaluated` and is
// never drawn, worded or coloured as clear.

/** True for a level state the scan could not check. */
export const levelUnchecked = (levelState) => levelState?.state === 'not-evaluated';

/** Why a level was not checked, in the scan's words. */
export const uncheckedReason = (levelState) => levelState?.reason || 'not evaluated';

/**
 * The names whose levels were not checked, from a scan's position and watchlist level states:
 * `[{ticker, reason}]`, one per name.
 */
export function uncheckedNames(scan) {
  const out = [];
  for (const section of [scan?.positions, scan?.watchlist]) {
    for (const [ticker, entry] of Object.entries(section ?? {})) {
      const bad = (entry?.levels ?? []).find(levelUnchecked);
      if (bad) out.push({ ticker, reason: uncheckedReason(bad) });
    }
  }
  return out;
}
