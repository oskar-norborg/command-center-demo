// Brand mark (docs/phase3-visual-plan.md §3.2/V2): a small concentric-ring glyph next to the "Command Center"
// wordmark in the top bar. Purely decorative — an original mark drawn here (SPEC.md §7.1/docs/phase3-plan.md §6:
// no borrowed icon, no icon font/library dependency), not a copy of the visual-reference mockup's own mark or
// name (docs/phase3-visual-plan.md's intro: that file is visual inspiration only — its exact glyph and product
// name are not reused; see tests/brand-name.test.js). Cyan-only (visual-pass Q3): decoration never borrows
// amber/red/green, which are reserved for warning states.
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** @param {number} [size] overall width/height, px */
export function brandMark({ size = 22 } = {}) {
  const root = svg('svg', {
    class: 'brand-mark', width: size, height: size, viewBox: '0 0 22 22',
    'aria-hidden': 'true', focusable: 'false',
  });
  root.appendChild(svg('circle', { cx: 11, cy: 11, r: 9.5, fill: 'none', stroke: 'var(--cyan)', 'stroke-width': 1 }));
  root.appendChild(svg('circle', { cx: 11, cy: 11, r: 4.5, fill: 'none', stroke: 'var(--cyan-dim)', 'stroke-width': 1 }));
  return root;
}
