// Motion primitives shared by every one-shot animation in the HUD (SPEC.md
// §5.9, docs/phase3-plan.md §2.5/§7 T3.2): rings drawing once in 500ms,
// numbers counting up once in 400ms, neither replayed when a route is
// revisited in the same page load, and everything shown at its final value
// immediately under reduced motion. Pure logic only — no DOM writes beyond
// the `onFrame`/callback the caller supplies, so this is unit-testable
// without a real browser and reusable by both ring.js and stat-tile.js.
//
// "Once per session" is tracked by a caller-supplied `key` in a module-level
// Set, not a WeakSet on a DOM node: command.js clears and rebuilds the whole
// panel on every render (dom.js's `clear` + rebuild), so the same logical
// ring/tile is a new DOM node each time and a WeakSet would never match. The
// Set only clears on a hard reload (module re-evaluation), matching T3.2's
// DoD ("back/forward navigation does not replay").
const animatedKeys = new Set();

/** True once `key` has already been through `countUp`/`shouldAnimateOnce` this page session. */
export function hasAnimated(key) {
  return Boolean(key) && animatedKeys.has(key);
}

/** Marks `key` as animated for the rest of this page session. */
export function markAnimated(key) {
  if (key) animatedKeys.add(key);
}

/** Test-only: forgets every key, as if the page had just loaded. */
export function resetAnimated() {
  animatedKeys.clear();
}

/**
 * SPEC.md §5.9: skip motion when the OS says so, or when settings (T3.4, localStorage) overrides it either way.
 * The override is checked first so a settings toggle can force motion on even under a reduced-motion OS default,
 * and force it off without needing the OS setting changed.
 */
export function prefersReducedMotion() {
  try {
    const override = typeof localStorage !== 'undefined' ? localStorage.getItem('reduced-motion') : null;
    if (override === 'on') return true;
    if (override === 'off') return false;
  } catch {
    // localStorage unavailable (private mode, tests without it) — fall through to the OS setting.
  }
  const w = typeof window !== 'undefined' ? window : globalThis;
  return typeof w.matchMedia === 'function' && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function raf(cb) {
  const w = typeof window !== 'undefined' ? window : globalThis;
  if (typeof w.requestAnimationFrame === 'function') return w.requestAnimationFrame(cb);
  return setTimeout(cb, 16);
}

/**
 * True only where a real compositor could actually draw a frame. The site's own test harness (jsdom without
 * `pretendToBeVisual`, `tests/site-scan.test.js` and friends) has no `requestAnimationFrame` at all — there is no
 * frame to draw there, so treating that the same as reduced motion (show the final value immediately) is both
 * correct and keeps every existing content assertion exact, not racing a real 400ms/500ms animation it never
 * asked to test (docs/phase3-plan.md §7 T3.2's DoD: tests cover the logic, not real animation timing).
 */
function canAnimate() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return typeof w.requestAnimationFrame === 'function';
}

/**
 * Wall-clock milliseconds, from `performance.now()` — deliberately not `Date.now()`: tests freeze `Date.now` to a
 * fixed instant to make the scan's age text deterministic (tests/site-scan.test.js), which would make `elapsed`
 * below stay 0 forever and this loop never finish. `performance.now()` is untouched by that and always advances.
 */
function nowMs() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return typeof w.performance?.now === 'function' ? w.performance.now() : Date.now();
}

/**
 * Whether a one-shot draw (a ring's sweep, a boot beat) identified by `key` should animate right now: false, and
 * `key` stays available to check again, under reduced motion (so the caller can still gate its own CSS); true only
 * once per session per `key`, marking it used either way (SPEC.md §5.9: "once, never on route-change back").
 */
export function shouldAnimateOnce(key) {
  if (hasAnimated(key)) return false;
  markAnimated(key);
  return canAnimate() && !prefersReducedMotion();
}

const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Counts from `from` to `to` over `duration` ms, calling `onFrame(value)` every frame with an ease-out curve;
 * calls `onFrame(to)` once, synchronously, and returns under reduced motion or once `key` has already animated
 * this session (SPEC.md §5.9's "everything must remain readable with animations off" — the final value is never
 * withheld). `raf`/`now` are injectable for deterministic tests.
 * @param {{key?: string, to: number, from?: number, duration?: number, onFrame: (value: number) => void, now?: () => number, raf?: (cb: () => void) => unknown}} args
 */
export function countUp({ key, to, from = 0, duration = 400, onFrame, now = nowMs, raf: rafFn = raf }) {
  if (typeof to !== 'number' || !Number.isFinite(to)) {
    onFrame(to);
    return;
  }
  if ((key && hasAnimated(key)) || prefersReducedMotion() || !canAnimate()) {
    if (key) markAnimated(key);
    onFrame(to);
    return;
  }
  if (key) markAnimated(key);
  // Paint the starting value synchronously, so there is no flash of an unformatted/final value before the first
  // scheduled frame lands (the caller would otherwise have to guess whether this call is about to animate).
  onFrame(from);
  const start = now();
  const step = () => {
    const elapsed = now() - start;
    const t = Math.min(1, duration <= 0 ? 1 : elapsed / duration);
    onFrame(from + (to - from) * easeOut(t));
    if (t < 1) rafFn(step);
  };
  rafFn(step);
}
