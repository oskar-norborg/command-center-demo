// Boot sequence (SPEC.md §5.9, docs/phase3-plan.md §7 T3.4): three lines of
// mono text and a ring sweep, at most 1.2s, skippable by tap or any key,
// shown once per calendar day (localStorage), skipped under reduced motion
// or the settings toggle, always shown in the demo build (every load, not
// once/day — a visitor's first look should always include it).
import { el, text } from '../dom.js';
import { ring } from './ring.js';
import { prefersReducedMotion } from '../lib/animate.js';
import { todayEt } from '../data.js';

const SEEN_KEY_PREFIX = 'boot-seen-';
export const BOOT_ENABLED_KEY = 'boot-enabled';
export const DURATION_MS = 1200;

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: the boot sequence just runs every load instead of once/day — harmless.
  }
}

/** False only when settings (T3.4) explicitly turned the boot sequence off; on by default. */
export function bootEnabled() {
  return readLocalStorage(BOOT_ENABLED_KEY) !== 'off';
}

function seenToday(nowMs) {
  return readLocalStorage(SEEN_KEY_PREFIX + todayEt(nowMs)) === '1';
}

function markSeenToday(nowMs) {
  writeLocalStorage(SEEN_KEY_PREFIX + todayEt(nowMs), '1');
}

/**
 * Whether the boot sequence should run right now (pure with respect to time, like lib/calendar.js: `nowMs` is
 * passed in so this is testable without mocking the clock).
 * @param {{demo?: boolean, nowMs?: number}} [args]
 */
export function shouldBoot({ demo = false, nowMs = Date.now() } = {}) {
  if (prefersReducedMotion() || !bootEnabled()) return false;
  return demo || !seenToday(nowMs);
}

/**
 * Renders the boot overlay into `root`, resolving once it is done — by the 1.2s timeout, a tap, or any key. Marks
 * today as seen either way (even in demo, where it always *shows*, so a non-demo reload later the same day still
 * has its own once/day gate consulted fresh — this only affects a non-demo build).
 * @param {HTMLElement} root
 * @param {{nowMs?: number}} [args]
 * @returns {Promise<void>}
 */
export function runBoot(root, { nowMs = Date.now() } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'boot-overlay', attrs: { role: 'status', 'aria-label': 'Command Center is loading' } }, [
      ring({ segments: [{ pct: 100, color: 'var(--cyan)' }], size: 72, thickness: 6, key: 'boot-ring' }),
      el('div', { class: 'boot-lines' }, [
        text('p', 'COMMAND CENTER'),
        text('p', 'LINKING SCAN STATE'),
        text('p', 'READY'),
      ]),
      text('p', 'tap or press any key to skip', { class: 'boot-skip' }),
    ]);
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      markSeenToday(nowMs);
      clearTimeout(timer);
      document.removeEventListener('keydown', finish);
      overlay.remove();
      resolve();
    };
    overlay.addEventListener('click', finish);
    document.addEventListener('keydown', finish);
    root.appendChild(overlay);
    timer = setTimeout(finish, DURATION_MS);
  });
}
