// Level bar (SPEC.md §5.7, T1.7): one SVG track per dossier with the level
// markers, the GAV, and the current price on it. Functional, not yet the HUD
// look: it draws the right things in the right places and carries the classes
// the design pass will style (`is-near` halo, `is-hit` pulse, §5.9).
//
// It only displays. Level states come from the scan output (`states`), never
// from evaluating levels here (SPEC.md §5.1: no client-side numbers); the
// shared lib/levels.js is used only to know which prices a level occupies.
//
// Layout uses percentages for every horizontal position, so the bar is full
// width at any screen size without measuring anything. Height is 64 px.
//
// Level-bar rework (2026-09-22): close-together levels crowd their labels
// together on the SVG bar at 360px (percentage-based layout has no way to
// know two labels will overlap before they do). `levelBar` now also builds
// `verticalList`, a plain high-to-low `<ul>` of the same levels/GAV/price —
// both are always in the DOM; hud.css shows the SVG bar at/above the 900px
// desktop breakpoint and the vertical list below it, never both at once, so
// nothing is ever read twice and nothing can overlap on a phone.

import { isEvaluable, levelTargets } from '../../lib/levels.js';
import { el } from '../dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const BAR_HEIGHT = 64;
/** §5.7: the scale runs from 8 % below the lowest price to 8 % above the highest. */
export const SCALE_LOW = 0.92;
export const SCALE_HIGH = 1.08;

const PRICE_LABEL_Y = 11;
const CARET_Y = 25;
const TRACK_Y = 36;
const TICK_HALF = 8;
const LABEL_ROWS = [52, 62];

const SHORT_TYPE = { buy: 'buy', add: 'add', trim: 'trim', exit: 'exit', invalidation: 'inval', watchpoint: 'watch' };

let barCounter = 0;

const isPrice = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** `{min, max}` of the drawn scale for these prices, or null if there are none. */
export function barScale(values) {
  const prices = values.filter(isPrice);
  if (prices.length === 0) return null;
  return { min: Math.min(...prices) * SCALE_LOW, max: Math.max(...prices) * SCALE_HIGH };
}

/** Horizontal position of `value` on the scale, in percent of the bar's width. */
export function positionPct(value, scale) {
  return ((value - scale.min) / (scale.max - scale.min)) * 100;
}

const pctAttr = (n) => `${n.toFixed(2)}%`;

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

function svgText(content, attrs, tag = 'text') {
  const node = svg(tag, attrs);
  node.textContent = content;
  return node;
}

/** A `<title>` child: the native tooltip for a shape. */
const svgTitle = (content) => svgText(content, {}, 'title');

/** One row per shape (a tick, or a zone's high/low pair collapsed to one row keyed on its high edge), plus GAV
 * and the current price — sorted high price to low, for the phone-only vertical list below. */
function verticalRows(drawn, gav, price) {
  const rows = [];
  for (const { level, shapes } of drawn) {
    // The SVG's "hatch" shape (an unresolved level's shaded band + "?" between its candidates) is a property of
    // drawing a *range* on a line, not a fact worth its own row here — each candidate already gets its own tick
    // row below, which is the vertical list's whole "no answer yet" signal (§3: dashed, dimmed — is-unchecked
    // reaches every candidate that has no scan state, same as the SVG).
    for (const shape of shapes.filter((s) => s.kind !== 'hatch')) {
      rows.push({ sortPrice: shape.kind === 'tick' ? shape.price : shape.high, level, text: shape.text });
    }
  }
  if (isPrice(gav)) rows.push({ sortPrice: gav, level: null, kind: 'gav', text: `GAV ${gav}` });
  // "Current", not just the ▼ glyph the SVG uses: the row's own marker is already shaped like that caret (hud.css),
  // so the text says in words what a screen reader needs — a shape alone wouldn't carry "this is the price, not a
  // level" for anyone not seeing it (docs/phase3-visual-plan.md's level-bar rework, "obvious at a glance" addition).
  if (isPrice(price)) rows.push({ sortPrice: price, level: null, kind: 'now', text: `Current ${price}` });
  return rows.sort((a, b) => b.sortPrice - a.sortPrice);
}

/**
 * The phone-only vertical list (level-bar rework, 2026-09-22): every level, GAV and the current price, one row
 * each, high price to low — the direct fix for labels crowding together on the SVG bar at 360px (three or four
 * close prices with one far outlier, e.g. an exit at 100, a watchpoint at 115-120 and the GAV at 126.5 all within a few
 * percent of each other while trim sits at 180). hud.css shows this under 900px and the SVG bar at/above it, never both,
 * so nothing is read twice. Rows share the SVG's colour tokens and state classes (`is-hit`/`is-near`/
 * `is-unchecked`) so a level reads the same way regardless of which representation a given screen shows, and
 * share the `.level-marker` class so position.js's existing pulse-budget query (`.level-marker.is-hit`) finds
 * whichever one is actually in the DOM without a second query having to know which breakpoint is active.
 * Informational only, not interactive — every level's full condition/action text is already one scroll away in
 * the plain list `levelsPanel` (position.js) renders right below this.
 */
function verticalList(drawn, stateOf, gav, price) {
  const rows = verticalRows(drawn, gav, price).map((row) => {
    if (!row.level) {
      return el('li', { class: `level-vertical-row level-vertical-${row.kind}` }, [
        el('span', { class: 'level-vertical-marker', attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'level-vertical-text', text: row.text }),
      ]);
    }
    const state = stateOf.get(row.level.id)?.state;
    const stateClass = state === 'hit' ? ' is-hit' : state === 'near' ? ' is-near' : state === 'not-evaluated' ? ' is-unchecked' : '';
    return el('li', {
      class: `level-vertical-row level-marker level-${row.level.type} level-${row.level.status}${stateClass}`,
      attrs: { 'data-level-id': row.level.id },
    }, [
      el('span', { class: 'level-vertical-marker', attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'level-vertical-text', text: row.text }),
    ]);
  });
  return el('ul', { class: 'level-vertical' }, rows);
}

/** Keep a centred label inside the bar: left-anchor near the left edge, right-anchor near the right. */
function anchorFor(pct) {
  if (pct < 9) return 'start';
  if (pct > 91) return 'end';
  return 'middle';
}

/** `states` may be the scan's `levels` array or an id → state map; both become a Map by id. */
function stateMap(states) {
  if (!states) return new Map();
  if (states instanceof Map) return states;
  const entries = Array.isArray(states) ? states.map((s) => [s.id, s]) : Object.entries(states);
  return new Map(entries);
}

/** What one level draws: point ticks, a zone band, or (unresolved) candidate ticks with a hatched band. */
function shapesOf(level) {
  const { points, zone } = levelTargets(level);
  const shapes = points.map((p) => ({ kind: 'tick', price: p.price, text: `${p.price} ${SHORT_TYPE[level.type] ?? level.type}` }));
  if (zone) shapes.push({ kind: 'zone', low: zone.low, high: zone.high, text: `${zone.low}–${zone.high} ${SHORT_TYPE[level.type] ?? level.type}` });
  if (level.status === 'unresolved' && points.length >= 2) {
    const prices = points.map((p) => p.price);
    shapes.push({ kind: 'hatch', low: Math.min(...prices), high: Math.max(...prices), text: '?' });
  }
  return shapes;
}

/**
 * Build the level bar. Returns null when no level has a price to draw: the
 * GAV and the price are only placed against levels.
 * @param {object} args
 * @param {object[]} [args.levels]   position or watchlist `levels`; retired ones are not drawn
 * @param {number|null} [args.gav]
 * @param {number|null} [args.price]   the scan's price, only when there is a usable one
 * @param {object[]|Record<string, object>|Map<string, object>} [args.states]   the scan's `levels` states, by level id
 * @returns {HTMLElement|null}
 */
export function levelBar({ levels = [], gav = null, price = null, states } = {}) {
  const drawn = levels.filter(isEvaluable).map((level) => ({ level, shapes: shapesOf(level) })).filter((d) => d.shapes.length > 0);
  const extent = [
    ...drawn.flatMap(({ shapes }) => shapes.flatMap((s) => (s.kind === 'tick' ? [s.price] : [s.low, s.high]))),
    ...(isPrice(gav) ? [gav] : []),
    ...(isPrice(price) ? [price] : []),
  ];
  const scale = barScale(extent);
  if (scale === null || drawn.length === 0) return null;

  const id = `level-hatch-${(barCounter += 1)}`;
  const stateOf = stateMap(states);
  const at = (value) => positionPct(value, scale);

  const root = svg('svg', { class: 'level-bar', width: '100%', height: BAR_HEIGHT, role: 'img', 'aria-label': 'Levels, GAV and price' });
  root.appendChild(svg('defs', {}, [
    svg('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, [
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'level-hatch-line' }),
    ]),
  ]));
  root.appendChild(svg('line', { class: 'level-track', x1: '0%', x2: '100%', y1: TRACK_Y, y2: TRACK_Y }));

  const popover = el('div', { class: 'level-popover', attrs: { role: 'status', 'aria-live': 'polite' } });
  popover.hidden = true;
  let openKey = null;
  const toggle = (key, message) => {
    if (openKey === key) {
      openKey = null;
      popover.hidden = true;
      return;
    }
    openKey = key;
    popover.textContent = message;
    popover.hidden = false;
  };

  const labels = []; // {pct, text, className}: placed after all shapes are known, so neighbours can alternate rows

  for (const { level, shapes } of drawn) {
    const state = stateOf.get(level.id)?.state;
    const stateClass = state === 'hit' ? ' is-hit' : state === 'near' ? ' is-near' : state === 'not-evaluated' ? ' is-unchecked' : '';
    const typeClass = `level-marker level-${level.type} level-${level.status}${stateClass}`;
    const message = [
      `${SHORT_TYPE[level.type] ?? level.type}: ${level.action}`,
      level.condition,
      level.status === 'unresolved' && level.decision_needed ? `Decision needed: ${level.decision_needed}` : null,
    ].filter(Boolean).join('. ');

    const group = svg('g', { class: typeClass, tabindex: 0, role: 'button', 'data-level-id': level.id, 'aria-label': message }, [svgTitle(message)]);

    for (const shape of shapes) {
      if (shape.kind === 'tick') {
        const pct = at(shape.price);
        const x = pctAttr(pct);
        // A tick is a 2px line — effectively untappable on a phone. A transparent rect widens the actual tap
        // target to a comfortable width (SPEC.md §5's 44px touch-target rule, docs/phase3-plan.md T3.5a) without
        // changing what's drawn; percent-of-bar-width rather than a fixed px (SVG can't mix the two units here),
        // tuned so it's close to 44px on a typical phone-width bar and only ever more generous on a wider one.
        group.appendChild(svg('rect', {
          class: 'level-hit-area', x: pctAttr(Math.max(0, pct - 3)), width: '6%', y: 0, height: BAR_HEIGHT, fill: 'transparent',
        }));
        group.appendChild(svg('line', { class: 'level-tick', x1: x, x2: x, y1: TRACK_Y - TICK_HALF, y2: TRACK_Y + TICK_HALF }));
        if (state === 'near') group.appendChild(svg('circle', { class: 'level-halo', cx: x, cy: TRACK_Y, r: TICK_HALF + 4, fill: 'none' }));
        labels.push({ pct: at(shape.price), text: shape.text, className: `level-label level-${level.type}` });
      } else if (shape.kind === 'zone') {
        const left = at(shape.low);
        group.appendChild(svg('rect', {
          class: 'level-zone', x: pctAttr(left), width: pctAttr(at(shape.high) - left), y: TRACK_Y - TICK_HALF, height: TICK_HALF * 2,
        }));
        labels.push({ pct: (left + at(shape.high)) / 2, text: shape.text, className: `level-label level-${level.type}` });
      } else {
        const left = at(shape.low);
        const width = at(shape.high) - left;
        group.appendChild(svg('rect', {
          class: 'level-unresolved-band', x: pctAttr(left), width: pctAttr(width), y: TRACK_Y - TICK_HALF, height: TICK_HALF * 2, fill: `url(#${id})`,
        }));
        group.appendChild(svgText('?', { class: 'level-question', x: pctAttr(left + width / 2), y: TRACK_Y + 4, 'text-anchor': 'middle' }));
      }
    }

    const key = level.id;
    group.addEventListener('click', () => toggle(key, message));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle(key, message);
      }
    });
    root.appendChild(group);
  }

  if (isPrice(gav)) {
    const x = pctAttr(at(gav));
    root.appendChild(svg('circle', { class: 'level-gav', cx: x, cy: TRACK_Y, r: 5, fill: 'none', 'data-gav': gav }, [svgTitle(`GAV ${gav}`)]));
    labels.push({ pct: at(gav), text: `GAV ${gav}`, className: 'level-label level-gav-label' });
  }

  labels.sort((a, b) => a.pct - b.pct).forEach((label, i) => {
    root.appendChild(svgText(label.text, {
      class: label.className, x: pctAttr(label.pct), y: LABEL_ROWS[i % LABEL_ROWS.length], 'text-anchor': anchorFor(label.pct),
    }));
  });

  if (isPrice(price)) {
    const pct = at(price);
    root.appendChild(svgText(String(price), { class: 'level-price-label', x: pctAttr(pct), y: PRICE_LABEL_Y, 'text-anchor': anchorFor(pct) }));
    root.appendChild(svgText('▼', { class: 'level-price', x: pctAttr(pct), y: CARET_Y, 'text-anchor': 'middle', 'data-price': price }));
  }

  return el('div', { class: 'level-bar-wrap' }, [root, verticalList(drawn, stateOf, gav, price), popover]);
}
