// Charts (experimental visuals, 2026-11-16): a line chart with a hover readout, and a level track. On by default in
// the demo build and off on the real site until its Settings toggle says otherwise (`visualsOn`).
//
// They only display (SPEC.md §5.1). Every point is a figure a scan published, copied into data/series.json and
// data/history.json by the build; the one thing computed here is a line's change from its first shown point, which
// is how two series with different units share an axis, and the chart says so in its caption.
//
// Layout: the lines are an SVG stretched to the box (`preserveAspectRatio="none"`, strokes kept at their own width),
// and every label is HTML placed by percentage, so text stays the same size on a phone and a desktop and nothing is
// measured. The chart is one focusable image with a text summary; left and right arrow keys move the readout, as a
// pointer does. The sentence under it carries the same facts for anyone who cannot see the picture.

import { el, text } from '../dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORE_KEY = 'cc-visuals';

/** Are the experimental visuals on? The Settings toggle wins; without one, on in the demo and off elsewhere. */
export function visualsOn(config) {
  try {
    const stored = globalThis.localStorage?.getItem(STORE_KEY);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch {
    // storage unavailable: fall through to the default
  }
  return config?.demo === true;
}

/** Store the Settings toggle's choice (`true`, `false`, or `null` to go back to the default). */
export function setVisuals(value) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(STORE_KEY);
    else globalThis.localStorage?.setItem(STORE_KEY, value ? 'on' : 'off');
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};
const pct = (n) => `${n.toFixed(2)}%`;

/** "Nice" tick values covering [min, max]: about `count` of them, on 1/2/5 steps. */
export function niceTicks(min, max, count = 4) {
  if (!isNum(min) || !isNum(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** The SVG path of one series over `n` slots: gaps (null) break the line. `yOf` maps a value to 0–100 (top down). */
export function linePath(values, yOf) {
  const n = values.length;
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (!isNum(v)) { pen = false; return; }
    const x = n === 1 ? 50 : (i / (n - 1)) * 100;
    d += `${pen ? 'L' : 'M'}${x.toFixed(2)} ${yOf(v).toFixed(2)} `;
    pen = true;
  });
  return d.trim();
}

/**
 * A line chart.
 * @param {object} args
 * @param {string[]} args.labels   one per slot (a session date, already formatted)
 * @param {{name: string, values: (number|null)[], cls?: string}[]} args.lines   same length as `labels`
 * @param {{value: number, name: string, cls?: string}[]} [args.marks]   horizontal reference lines (levels, GAV)
 * @param {(n: number) => string} args.format   a value as text
 * @param {string} args.summary   what the picture shows, for a screen reader
 * @param {number} [args.height]   px
 */
export function lineChart({ labels, lines, marks = [], format, summary, height = 200 }) {
  const n = labels.length;
  const all = [...lines.flatMap((l) => l.values), ...marks.map((m) => m.value)].filter(isNum);
  if (n < 2 || all.length === 0) return text('p', 'Not enough closes to draw yet.', { class: 'muted' });
  let min = Math.min(...all);
  let max = Math.max(...all);
  const pad = (max - min || Math.abs(max) || 1) * 0.08;
  min -= pad;
  max += pad;
  const yOf = (v) => 100 - ((v - min) / (max - min)) * 100;
  const xOf = (i) => (i / (n - 1)) * 100;

  const plot = svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'chart-svg', 'aria-hidden': 'true' });
  const ticks = niceTicks(min, max, 4);
  for (const t of ticks) plot.appendChild(svg('line', { x1: 0, x2: 100, y1: yOf(t), y2: yOf(t), class: 'chart-grid' }));
  for (const m of marks) plot.appendChild(svg('line', { x1: 0, x2: 100, y1: yOf(m.value), y2: yOf(m.value), class: `chart-mark ${m.cls ?? ''}` }));
  lines.forEach((l, i) => {
    if (i === 0) {
      // A soft fill under the first line only, down to the bottom of the box.
      const d = linePath(l.values, yOf);
      const firstAt = l.values.findIndex(isNum);
      const lastAt = l.values.length - 1 - [...l.values].reverse().findIndex(isNum);
      if (d && !d.slice(1).includes('M')) plot.appendChild(svg('path', { d: `${d} L${xOf(lastAt).toFixed(2)} 100 L${xOf(firstAt).toFixed(2)} 100 Z`, class: 'chart-area' }));
    }
    plot.appendChild(svg('path', { d: linePath(l.values, yOf), class: `chart-line ${l.cls ?? ''}`, 'vector-effect': 'non-scaling-stroke' }));
  });

  const box = el('div', { class: 'chart-box', attrs: { style: `height:${height}px` } }, [plot]);
  for (const t of ticks) box.appendChild(text('span', format(t), { class: 'chart-ytick', attrs: { style: `top:${pct(yOf(t))}` } }));
  for (const m of marks) box.appendChild(text('span', m.name, { class: `chart-marklabel ${m.cls ?? ''}`, attrs: { style: `top:${pct(yOf(m.value))}` } }));
  const cursor = el('div', { class: 'chart-cursor', attrs: { hidden: '' } });
  box.appendChild(cursor);
  const dots = lines.map((l) => {
    const dot = el('span', { class: `chart-dot ${l.cls ?? ''}`, attrs: { hidden: '' } });
    box.appendChild(dot);
    return dot;
  });

  const readout = el('p', { class: 'chart-readout', attrs: { 'aria-live': 'off' } });
  const describe = (i) => `${labels[i]} · ${lines.map((l) => `${l.name} ${isNum(l.values[i]) ? format(l.values[i]) : '—'}`).join(' · ')}`;
  let at = n - 1;
  const show = (i, withCursor) => {
    at = Math.max(0, Math.min(n - 1, i));
    readout.textContent = describe(at);
    cursor.hidden = !withCursor;
    cursor.style.left = pct(xOf(at));
    lines.forEach((l, k) => {
      const v = l.values[at];
      dots[k].hidden = !withCursor || !isNum(v);
      if (isNum(v)) { dots[k].style.left = pct(xOf(at)); dots[k].style.top = pct(yOf(v)); }
    });
  };
  show(n - 1, false);
  const indexAt = (event) => {
    const r = box.getBoundingClientRect();
    return r.width ? Math.round(((event.clientX - r.left) / r.width) * (n - 1)) : n - 1;
  };
  box.addEventListener('pointermove', (e) => show(indexAt(e), true));
  box.addEventListener('pointerdown', (e) => show(indexAt(e), true));
  box.addEventListener('pointerleave', () => show(n - 1, false));

  const legend = el('div', { class: 'chart-legend' }, lines.map((l) => el('span', { class: 'chart-key' }, [el('i', { class: `chart-swatch ${l.cls ?? ''}` }), text('span', l.name)])));
  const xAxis = el('div', { class: 'chart-xaxis', attrs: { 'aria-hidden': 'true' } }, [text('span', labels[0]), text('span', labels[Math.floor((n - 1) / 2)]), text('span', labels[n - 1])]);
  const figure = el('div', { class: 'chart', attrs: { role: 'img', tabindex: '0', 'aria-label': summary } }, [legend, box, xAxis, readout]);
  figure.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { show(at - 1, true); e.preventDefault(); }
    if (e.key === 'ArrowRight') { show(at + 1, true); e.preventDefault(); }
    if (e.key === 'Escape') show(n - 1, false);
  });
  figure.addEventListener('blur', () => show(n - 1, false));
  return figure;
}

/**
 * A row of buttons that choose how many of the newest closes a chart shows. `onPick(count)` redraws.
 * @param {{label: string, count: number}[]} ranges
 */
export function rangePicker(ranges, picked, onPick) {
  const group = el('div', { class: 'chart-ranges', attrs: { role: 'group', 'aria-label': 'Range' } });
  for (const r of ranges) {
    const b = text('button', r.label, { class: `chart-range${r.count === picked ? ' is-on' : ''}`, attrs: { type: 'button', 'aria-pressed': String(r.count === picked) } });
    b.addEventListener('click', () => onPick(r.count));
    group.appendChild(b);
  }
  return group;
}

/** Change of each value from the first number in `values`, in percent; null where either is missing. */
export function changeFromFirst(values) {
  const first = values.find(isNum);
  return values.map((v) => (isNum(v) && isNum(first) && first !== 0 ? (v / first - 1) * 100 : null));
}

/**
 * A level track: where the price sits between the level below it and the level above it.
 * @param {object} args
 * @param {number} args.price
 * @param {{price: number, name: string, type: string}|null} args.below   the nearest active level under the price
 * @param {{price: number, name: string, type: string}|null} args.above   the nearest active level over it
 * @param {number|null} [args.gav]
 */
export function levelTrack({ price, below, above, gav = null }) {
  const lo = below?.price ?? price * 0.9;
  const hi = above?.price ?? price * 1.1;
  if (!isNum(price) || !(hi > lo)) return null;
  const span = (hi - lo) || 1;
  const at = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const track = el('div', { class: 'ltrack', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { class: `ltrack-end ltrack-lo ${below ? `is-${below.type}` : 'is-open'}` }),
    el('span', { class: `ltrack-end ltrack-hi ${above ? `is-${above.type}` : 'is-open'}` }),
    isNum(gav) && gav > lo && gav < hi ? el('span', { class: 'ltrack-gav', attrs: { style: `left:${pct(at(gav))}`, title: `GAV ${gav}` } }) : null,
    el('span', { class: 'ltrack-price', attrs: { style: `left:${pct(at(price))}` } }),
  ].filter(Boolean));
  return track;
}
