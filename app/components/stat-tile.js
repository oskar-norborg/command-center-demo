// StatTile (SPEC.md §5.8), docs/phase3-plan.md §2.4/T3.2. Replaces a bare
// `<p class="book-total">`: large white mono number that counts up once per
// session (site/app/lib/animate.js) — the book total today, any other single "big
// number" tile later. It only formats and displays a value the caller
// already computed.
import { el, text } from '../dom.js';
import { countUp } from '../lib/animate.js';
import { money } from '../data.js';

/**
 * @param {object} args
 * @param {number} args.value   the number to count up to; a non-number renders as `—` with no animation
 * @param {string} [args.prefix]   e.g. `'≈ '`
 * @param {string} [args.suffix]   e.g. `' NOK'`
 * @param {string} [args.key]   per-session "already animated" key (site/app/lib/animate.js) — stable across re-renders
 * @param {string} [args.className]   extra class(es) on the wrapping element, e.g. the existing `book-total` hook
 * @returns {HTMLElement}
 */
export function statTile({ value, prefix = '', suffix = '', key, className = '' }) {
  const format = (v) => (typeof v === 'number' ? `${prefix}${money(v)}${suffix}` : '—');
  // countUp (site/app/lib/animate.js) paints the first frame synchronously — from `0` if it is about to animate, or `value`
  // itself immediately if reduced motion/already-animated-this-session skips the count-up — so the span never
  // shows an unformatted placeholder or flashes the final value before animating.
  const span = text('span', typeof value === 'number' ? '' : format(value), { class: 'stat-tile-value' });
  if (typeof value === 'number') {
    countUp({ key, to: value, duration: 400, onFrame: (v) => { span.textContent = format(v); } });
  }
  return el('p', { class: `stat-tile ${className}`.trim() }, [span]);
}
