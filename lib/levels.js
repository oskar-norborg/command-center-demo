// Level semantics (SPEC.md §3.2, §4.7): given a level, a price and last run's
// state, what state is the level in and how far is it? Pure and dependency-free
// on purpose: the scan imports this file directly and the site build copies it
// to dist/lib/levels.js, so it must run unchanged in Node and in a browser.
//
// The reading of the §3.2 table used here is written down in SPEC.md §3.2
// ("Level evaluation pinned"); this file cites it instead of restating it.

/** Which way a `price` level is hit when the level has no `direction` of its own. `null`: not directional. */
export const DEFAULT_DIRECTION = Object.freeze({
  buy: 'below',
  add: 'below',
  trim: 'above',
  exit: 'below',
  invalidation: 'below',
  watchpoint: null,
});

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);
const isPrice = (n) => isNumber(n) && n > 0;
// Threshold comparisons drop float noise at the sixth decimal, as lib/quote-checks.js does.
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const round1 = (x) => Math.round(x * 10) / 10 + 0; // `+ 0` turns -0 into 0

/** Only active and unresolved levels are evaluated (§4.7); retired ones are history. */
export function isEvaluable(level) {
  return level?.status === 'active' || level?.status === 'unresolved';
}

/**
 * The prices a level is judged against: single prices (each with the direction
 * it is hit from), and an inside-the-range zone. An unresolved level has one
 * single price per candidate. A single price with no direction (a `watchpoint`
 * given only a `price`) is a degenerate zone [price, price]: hit only at that
 * exact price.
 * @returns {{points: {price: number, label?: string, direction: 'above'|'below'|null}[], zone: {low: number, high: number}|null}}
 */
export function levelTargets(level) {
  const direction = level?.direction ?? DEFAULT_DIRECTION[level?.type] ?? null;
  if (level?.status === 'unresolved') {
    const points = (level.candidates ?? [])
      .filter((c) => isPrice(c?.price))
      .map((c) => ({ price: c.price, label: c.label, direction }));
    return { points, zone: null };
  }
  const points = isPrice(level?.price) ? [{ price: level.price, direction }] : [];
  const zone = isPrice(level?.price_low) && isPrice(level?.price_high) ? { low: level.price_low, high: level.price_high } : null;
  return { points, zone };
}

/** Every price a level occupies, for drawing: single prices, range edges, candidates. */
export function levelPrices(level) {
  const { points, zone } = levelTargets(level);
  return [...points.map((p) => p.price), ...(zone ? [zone.low, zone.high] : [])];
}

/**
 * One target against a price: is it hit, how far is the level from the price
 * (signed, % of price), and which level price was measured to (`ref`; null when
 * the price is inside a zone, where nothing is measured).
 */
function judge(price, target) {
  let low;
  let high;
  if (target.low !== undefined) {
    ({ low, high } = target);
  } else if (target.direction === 'below') {
    return { hit: price <= target.price, distance: ((target.price - price) / price) * 100, ref: target.price };
  } else if (target.direction === 'above') {
    return { hit: price >= target.price, distance: ((target.price - price) / price) * 100, ref: target.price };
  } else {
    low = target.price;
    high = target.price;
  }
  if (price >= low && price <= high) return { hit: true, distance: 0, ref: null };
  const edge = price > high ? high : low;
  return { hit: false, distance: ((edge - price) / price) * 100, ref: edge };
}

/** Near-level distance: the level's own `near_pct`, else `rules.near_level_pct`, else 0 (no near state). */
function nearPctFor(level, rules) {
  if (isNumber(level?.near_pct) && level.near_pct >= 0) return level.near_pct;
  if (isNumber(rules?.near_level_pct) && rules.near_level_pct >= 0) return rules.near_level_pct;
  return 0;
}

/** Judge every target of a level; `state` and `distance` are the level's. */
function assess(level, price, rules) {
  const { points, zone } = levelTargets(level);
  const targets = [...points, ...(zone ? [zone] : [])];
  const near = nearPctFor(level, rules);
  const rows = targets.map((target) => {
    const { hit, distance, ref } = judge(price, target);
    const state = hit ? 'hit' : round6(Math.abs(distance)) <= near ? 'near' : 'clear';
    return { target, state, distance, ref };
  });
  return rows;
}

const SEVERITY = { hit: 2, near: 1, clear: 0 };

/**
 * State of one level at `price`, for the scan output's `positions[t].levels`
 * and `watchlist[t].levels` (schemas/scan.schema.json `scanLevel`, minus `id`).
 *
 * - `hit`: any target is hit; `near`: none is hit and one is within the near
 *   distance of the price; `clear` otherwise. Every candidate of an unresolved
 *   level counts (§3.2).
 * - `distance_pct` is signed, `(level − price) / price × 100` to one decimal, for
 *   the target that decides the state (nearest hit, else nearest of all).
 *   Inside a zone it is 0; outside, it is measured to the nearer edge.
 * - `hit_streak_sessions` is last run's streak plus one while the level is hit,
 *   else 0. `prevState` is the same level's entry from the previous close run.
 * - A missing or invalid price gives `{state: 'not-evaluated', distance_pct: null,
 *   hit_streak_sessions: 0}`: the level was not evaluated, and nothing is invented.
 *   It is never `clear`: `clear` means "checked, and not near" (audit 2026-09-19, #2).
 * - A retired level is not evaluated: `null`.
 * @param {object} level   a level from a position or watchlist file
 * @param {number|null|undefined} price
 * @param {{state?: string, hit_streak_sessions?: number}|null|undefined} prevState
 * @param {{near_level_pct?: number}} [rules]   portfolio.yaml `rules`
 * @returns {{state: 'clear'|'near'|'hit'|'not-evaluated', distance_pct: number|null, hit_streak_sessions: number}|null}
 */
export function evaluateLevel(level, price, prevState, rules) {
  const d = describeLevel(level, price, prevState, rules);
  return d && { state: d.state, distance_pct: d.distance_pct, hit_streak_sessions: d.hit_streak_sessions };
}

/** The state of a level that could not be checked. Deliberately not `clear`. */
export const NOT_EVALUATED_STATE = 'not-evaluated';

const NOT_EVALUATED = Object.freeze({ state: NOT_EVALUATED_STATE, distance_pct: null, hit_streak_sessions: 0, level_price: null, zone: null, label: undefined });

/**
 * `evaluateLevel` plus what an alert needs to say about it: the level price
 * the state was decided against (`level_price`: the deciding single price or
 * candidate, or the nearer edge of a zone the price is outside; null inside a
 * zone or when not evaluated), that zone when the deciding target is one
 * (`zone: {low, high}`), and the candidate's `label` for an unresolved level.
 * @returns {{state: string, distance_pct: number|null, hit_streak_sessions: number, level_price: number|null,
 *   zone: {low: number, high: number}|null, label: string|undefined}|null}
 */
export function describeLevel(level, price, prevState, rules) {
  if (!isEvaluable(level)) return null;
  if (!isPrice(price)) return { ...NOT_EVALUATED };

  const rows = assess(level, price, rules);
  if (rows.length === 0) return { ...NOT_EVALUATED };

  const best = rows.reduce((a, b) => {
    if (SEVERITY[b.state] !== SEVERITY[a.state]) return SEVERITY[b.state] > SEVERITY[a.state] ? b : a;
    return Math.abs(b.distance) < Math.abs(a.distance) ? b : a;
  });

  let streak = 0;
  if (best.state === 'hit') {
    const before = prevState?.state === 'hit'
      ? (Number.isInteger(prevState.hit_streak_sessions) && prevState.hit_streak_sessions > 0 ? prevState.hit_streak_sessions : 1)
      : 0;
    streak = before + 1;
  }
  const isZone = best.target.low !== undefined;
  return {
    state: best.state,
    distance_pct: round1(best.distance),
    hit_streak_sessions: streak,
    level_price: best.ref,
    zone: isZone ? { low: best.target.low, high: best.target.high } : null,
    label: best.target.label,
  };
}

/**
 * Per-candidate detail for an unresolved level, for alert text such as
 * `UNRESOLVED (23 / 28)`. Same state and distance rules as `evaluateLevel`.
 * Empty for any other level, or with no valid price.
 * @returns {{price: number, label: string|undefined, state: 'clear'|'near'|'hit', distance_pct: number}[]}
 */
export function evaluateCandidates(level, price, rules) {
  if (level?.status !== 'unresolved' || !isPrice(price)) return [];
  return assess(level, price, rules).map(({ target, state, distance }) => ({
    price: target.price,
    label: target.label,
    state,
    distance_pct: round1(distance),
  }));
}
