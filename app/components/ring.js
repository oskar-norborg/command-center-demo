// Ring (SPEC.md §5.8: "SVG arc, 6px stroke"), docs/phase3-plan.md §2.4/T3.2.
// Used by the Book panel for the funds/stocks/cash allocation and, smaller,
// for tech exposure vs its cap (§4.2). It only draws what the caller already
// computed — no percentage is derived here.
//
// Draw-in technique: each segment circle keeps a constant `stroke-dasharray`
// equal to the full circumference (so the whole ring is "on"), rotated so
// its own arc starts at the right point on the circle, and its
// `stroke-dashoffset` is animated from "fully hidden" down to the offset
// that reveals exactly its length — the standard SVG "draw a stroke" trick,
// which (unlike animating `stroke-dasharray` itself) is a single interpolated
// number and transitions smoothly in every browser.
import { shouldAnimateOnce } from '../lib/animate.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function raf2(cb) {
  const w = typeof window !== 'undefined' ? window : globalThis;
  const r = typeof w.requestAnimationFrame === 'function' ? w.requestAnimationFrame.bind(w) : (fn) => setTimeout(fn, 16);
  r(() => r(cb));
}

/**
 * @param {object} args
 * @param {{pct: number, color: string}[]} args.segments   each 0-100, drawn clockwise from 12 o'clock in order
 * @param {number} [args.size]   overall SVG width/height, px
 * @param {number} [args.thickness]   stroke width, px (SPEC.md §5.8: 6px)
 * @param {string} args.key   per-session "already drawn" key (site/app/lib/animate.js) — must be stable across re-renders
 *   of the same logical ring so it never replays on route-change-back (T3.2 DoD)
 * @param {string} [args.label]   aria-label for the SVG (role="img")
 * @returns {SVGSVGElement}
 */
export function ring({ segments, size = 96, thickness = 6, key, label = '' }) {
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const animate = shouldAnimateOnce(key);

  const root = svg('svg', {
    class: 'ring', width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': label,
  });
  root.appendChild(svg('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, 'stroke-width': thickness }));

  let startPct = 0;
  for (const seg of segments) {
    const pct = Math.max(0, Math.min(100, seg.pct ?? 0));
    const len = (pct / 100) * circumference;
    const startAngle = (startPct / 100) * 360;
    const finalOffset = circumference - len;
    const circle = svg('circle', {
      class: 'ring-segment', cx: size / 2, cy: size / 2, r, 'stroke-width': thickness,
      'stroke-dasharray': circumference.toFixed(2),
      'stroke-dashoffset': animate ? circumference.toFixed(2) : finalOffset.toFixed(2),
      transform: `rotate(${(-90 + startAngle).toFixed(2)} ${size / 2} ${size / 2})`,
    });
    circle.style.stroke = seg.color;
    if (animate) {
      raf2(() => { circle.style.strokeDashoffset = finalOffset.toFixed(2); });
    }
    root.appendChild(circle);
    startPct += pct;
  }

  return root;
}
