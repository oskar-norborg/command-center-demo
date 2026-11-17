// Ring gauge (docs/phase3-visual-plan.md §3.4/V4): wraps ring.js's allocation ring with two purely decorative
// layers — a static tick ring and a slowly spinning dashed outer ring — and a centre label. The gauge itself adds
// no information a screen reader needs: the accessible sentence under it (bookPanel, command.js) already says
// every number and date in words; this wrapper and everything in it is aria-hidden.
//
// The tick ring and dashed ring are drawn in CSS only (hud.css's .ring-gauge::before/::after), not new SVG/DOM,
// so this file only builds the wrapper structure ring.js's own SVG and the centre label sit inside.
import { el, text } from '../dom.js';
import { ring } from './ring.js';

/** 132px at/above the desktop breakpoint (base.css's own 900px command-view breakpoint), 112px below it — read
 * once at render time (rings never resize after their one-shot draw-in, same as the rest of ring.js), not on a
 * resize listener. Falls back to the smaller, phone-first size when matchMedia isn't available (a test harness,
 * or a browser without it) — the safe default, same reasoning lib/animate.js's prefersReducedMotion() uses for
 * a missing matchMedia. */
export function gaugeSizeForViewport() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  const desktop = typeof w.matchMedia === 'function' && w.matchMedia('(min-width: 900px)').matches;
  return desktop ? 132 : 112;
}

/**
 * @param {object} args
 * @param {{pct: number, color: string}[]} args.segments   passed straight through to ring.js
 * @param {string} args.key   ring.js's per-session draw-once key
 * @param {number} [args.size]   the allocation ring's own SVG size, px (thickness stays ring.js's 6px default —
 *   SPEC.md §5.8's "6px stroke", visual-pass Q4: the gauge reads larger through the wrapper's tick/dashed rings
 *   and a bigger `size` here, never a thicker stroke)
 * @param {string} [args.centreLabel]   short mono text, e.g. "ALLOC" — decorative (aria-hidden with the rest),
 *   never a new number (docs/phase3-visual-plan.md §3.4 explicitly rules out a count/percentage in the centre)
 */
export function ringGauge({ segments, key, size = 112, centreLabel = 'ALLOC', labels = null }) {
  ensureSpinPausesWhenHidden();
  const inner = ring({ segments, size, key });
  const wrap = el('div', { class: 'ring-gauge', attrs: { 'aria-hidden': 'true' } }, [
    inner,
    text('span', centreLabel, { class: 'ring-gauge-label' }),
  ]);
  if (!labels) return wrap;
  // Labels on the chart itself (2026-09-23, the owner: "the ring exists but doesn't read as one"): each part's name and
  // share sit next to its own arc, outside the spinning dashed ring, never over it. The chart is decoration to a
  // screen reader, like the gauge; the allocation sentence under it says the same numbers, with the basis date.
  const layout = ringLabelLayout({ segments, size });
  wrap.style.left = `calc(50% - ${size / 2}px)`;
  wrap.style.top = `${layout.ringTop}px`;
  const chart = el('div', { class: 'ring-chart', attrs: { 'aria-hidden': 'true', style: `height:${layout.height}px` } }, [wrap]);
  layout.labels.forEach((spot, i) => {
    const label = labels[i];
    if (!label) return;
    chart.appendChild(el('div', {
      class: `ring-label ring-label-${label.key ?? i} ${spot.side === 'left' ? 'is-left' : 'is-right'}`,
      attrs: { style: `left:calc(50% + ${spot.x.toFixed(1)}px);top:${spot.top.toFixed(1)}px` },
    }, [
      el('span', { class: 'ring-label-sw', attrs: { style: `background:${segments[i].color}` } }),
      text('span', label.name, { class: 'ring-label-name' }),
      text('span', label.value, { class: 'ring-label-value' }),
    ]));
  });
  return chart;
}

/** Room the spinning dashed ring takes outside the ring (hud.css `.ring-gauge::after`, `inset: -18px`) plus a margin. */
const SPIN_CLEARANCE = 18 + 5;
/** A label is two lines: 12px name over a 17px share. */
const LABEL_HEIGHT = 40;
const LABEL_GAP = 4;

/**
 * Where each segment's label goes, in px from the ring's centre: at the middle of its arc, pushed out until the whole
 * label clears the spinning ring, then spread apart on its side (left or right of the ring) so no two overlap.
 * Pure, for tests. `x` is the label's inner edge (it runs outward from there), `top` is relative to the chart.
 * @param {{segments: {pct: number}[], size: number}} args
 * @returns {{labels: {side: 'left'|'right', x: number, top: number, angle: number}[], height: number, ringTop: number}}
 */
export function ringLabelLayout({ segments, size }) {
  const r = size / 2;
  const clear = r + SPIN_CLEARANCE;
  const half = LABEL_HEIGHT / 2;
  let start = 0;
  const spots = segments.map((seg) => {
    const pct = Math.max(0, Math.min(100, seg.pct ?? 0));
    const angle = ((start + pct / 2) / 100) * 2 * Math.PI;   // 0 at 12 o'clock, clockwise
    start += pct;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    // The label's nearest corner to the centre is its anchor, offset half a label height toward the centre.
    let radius = clear;
    const cornerDistance = (R) => Math.hypot(R * sin, Math.max(0, Math.abs(R * cos) - half));
    while (cornerDistance(radius) < clear) radius += 1;
    return { side: sin >= 0 ? 'right' : 'left', x: radius * sin, y: -radius * cos, angle };
  });
  // Spread each side top to bottom so labels never overlap. A label moved down may now sit against the spinning ring
  // (two thin slices next to each other near 12 o'clock), so it then moves sideways, away from the ring, until clear.
  for (const side of ['left', 'right']) {
    const onSide = spots.filter((s) => s.side === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < onSide.length; i += 1) {
      const min = onSide[i - 1].y + LABEL_HEIGHT + LABEL_GAP;
      if (onSide[i].y < min) onSide[i].y = min;
    }
    for (const spot of onSide) {
      const dy = Math.max(0, Math.abs(spot.y) - half);
      if (Math.hypot(spot.x, dy) < clear) spot.x = (side === 'left' ? -1 : 1) * Math.ceil(Math.sqrt(clear * clear - dy * dy));
    }
  }
  const top = Math.min(-clear, ...spots.map((s) => s.y - half));
  const bottom = Math.max(clear, ...spots.map((s) => s.y + half));
  const origin = -top + 2;   // where the centre sits, from the chart's top
  return {
    labels: spots.map((s) => ({ side: s.side, x: s.x, top: origin + s.y - half, angle: s.angle })),
    height: Math.ceil(bottom - top + 4),
    ringTop: origin - r,
  };
}

// SPEC.md §5.9's one narrow motion exception (visual-pass Q1, resolved 2026-09-22): the dashed outer ring spins
// continuously, but is paused (not just slowed) whenever the tab isn't visible — a `body.ring-gauge-paused` class
// hud.css reads (`animation-play-state: paused`), toggled by one `visibilitychange` listener registered at most
// once (a module-level guard, not per-render: command.js clears and rebuilds the whole panel on every render, so
// ringGauge() itself can be called many times a session). Registered lazily, on first actual use, not at import
// time — nothing here runs just because this module was loaded.
let spinPauseRegistered = false;
function ensureSpinPausesWhenHidden() {
  if (spinPauseRegistered) return;
  spinPauseRegistered = true;
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  const update = () => doc.body?.classList.toggle('ring-gauge-paused', doc.hidden);
  doc.addEventListener('visibilitychange', update);
  update();
}

/** Test-only: forgets the registration, as if the module had just loaded. */
export function resetSpinPauseForTest() {
  spinPauseRegistered = false;
}
