// Experimental visuals (2026-11-16): the panels built from components/charts.js. On in the demo build, off on the
// real site until Settings turns them on (`visualsOn`). They only display: every point is a published scan figure
// from data/history.json and data/series.json; a "change since the first close shown" is the one thing worked out
// here, so that the book and a fund can share an axis, and each caption says so.

import { el, text } from '../dom.js';
import { money, shortDate } from '../data.js';
import { ccy } from '../../lib/base-currency.js';
import { changeFromFirst, levelTrack, lineChart, rangePicker } from '../components/charts.js';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const signedPct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
const panel = (title, note) => el('section', { class: 'panel visual-panel' }, [
  el('div', { class: 'panel-head' }, [text('h2', title), note ? text('span', note, { class: 'panel-note' }) : null].filter(Boolean)),
]);

const RANGES = [{ label: '10 closes', count: 10 }, { label: '30', count: 30 }, { label: 'All', count: Infinity }];

/** The fund with the largest value in the newest scan: the book's own yardstick. */
function yardstick(state, scan) {
  const funds = Object.entries(scan?.funds ?? {}).filter(([, f]) => isNum(f.value_nok)).sort((a, b) => b[1].value_nok - a[1].value_nok);
  const id = funds[0]?.[0];
  if (!id) return null;
  return { id, name: (state?.portfolio?.funds ?? []).find((f) => f.id === id)?.name ?? id };
}

/**
 * Command view: the book at each close against its largest fund, as change since the first close shown. Null when
 * there are fewer than two closes.
 */
export function bookChartPanel({ history, series, state, scan }) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const p = panel('Book over time', 'change since the first close shown');
  const bench = yardstick(state, scan);
  const navBySession = new Map((series?.sessions ?? []).map((s, i) => [s, series.navs?.[bench?.id]?.[i] ?? null]));
  const body = el('div', { class: 'visual-body' });
  const draw = (count) => {
    while (body.firstChild) body.removeChild(body.firstChild);
    const rows = Number.isFinite(count) ? history.slice(-count) : history;
    const book = changeFromFirst(rows.map((r) => r.total_nok));
    const lines = [{ name: 'Book', values: book, cls: 'is-a' }];
    const fundRaw = rows.map((r) => navBySession.get(r.session) ?? null);
    if (bench && fundRaw.filter(isNum).length >= 2) lines.push({ name: bench.name, values: changeFromFirst(fundRaw), cls: 'is-b' });
    const first = rows[0];
    const last = rows.at(-1);
    const lastBook = book.at(-1);
    const summary = `Book value from ${shortDate(first.session)} to ${shortDate(last.session)}: ${money(first.total_nok)} to ${money(last.total_nok)} ${ccy()}.`;
    body.appendChild(rangePicker(RANGES.filter((r) => !Number.isFinite(r.count) || r.count < history.length), count, draw));
    body.appendChild(lineChart({ labels: rows.map((r) => shortDate(r.session)), lines, format: signedPct, summary, height: 190 }));
    const fundLast = lines[1]?.values.filter(isNum).at(-1);
    body.appendChild(text('p',
      `Book ${money(first.total_nok)} → ${money(last.total_nok)} ${ccy()} over ${rows.length} closes (${isNum(lastBook) ? signedPct(lastBook) : '—'})`
      + `${isNum(fundLast) ? `; ${bench.name} ${signedPct(fundLast)} over the same closes` : ''}. `
      + 'The book line includes money moved in or out, so it is not a return.', { class: 'muted chart-caption' }));
  };
  draw(history.length > 30 ? 30 : Infinity);
  p.appendChild(body);
  return p;
}

const BELOW = new Set(['exit', 'invalidation', 'buy', 'add']);
const ABOVE = new Set(['trim']);
const SHORT = { exit: 'stop', invalidation: 'invalidation', trim: 'target', buy: 'buy', add: 'add' };

/** The nearest active level under the price and the nearest over it, with their distance in percent of the price. */
export function bracket(levels, price) {
  const active = (levels ?? []).filter((l) => l.status === 'active' && isNum(l.price));
  const under = active.filter((l) => l.price <= price && BELOW.has(l.type)).sort((a, b) => b.price - a.price)[0] ?? null;
  const over = active.filter((l) => l.price > price && ABOVE.has(l.type)).sort((a, b) => a.price - b.price)[0] ?? null;
  const dist = (l) => (l ? Math.abs(price / l.price - 1) * 100 : null);
  // A target the price has already reached: named in the row's words, since the track runs on to the next one.
  const reached = active.filter((l) => l.price <= price && ABOVE.has(l.type)).sort((a, b) => b.price - a.price)[0] ?? null;
  return { below: under, above: over, belowPct: dist(under), abovePct: dist(over), reached };
}

/**
 * Command view: one row per holding with a price and at least one level around it, nearest to a level first. The
 * price is the one the scan valued the holding at.
 */
export function levelTracksPanel({ state, scan }) {
  const rows = [];
  for (const [ticker, pos] of Object.entries(state?.positions ?? {})) {
    const price = scan?.positions?.[ticker]?.priced?.price;
    if (!isNum(price)) continue;
    const b = bracket(pos.levels, price);
    if (!b.below && !b.above) continue;
    rows.push({ ticker, pos, price, ...b, nearest: b.reached ? 0 : Math.min(b.belowPct ?? Infinity, b.abovePct ?? Infinity) });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.nearest - b.nearest);
  const p = panel('Distance to levels', 'nearest first');
  const list = el('ul', { class: 'ltrack-list' });
  for (const r of rows) {
    const side = (l, pctAway, word) => (l ? `${pctAway.toFixed(1)}% ${word} ${SHORT[l.type] ?? l.type} ${l.price}` : null);
    const words = [r.reached ? `at or past target ${r.reached.price}` : null, side(r.below, r.belowPct, 'above'), side(r.above, r.abovePct, 'below')].filter(Boolean).join(' · ');
    const track = levelTrack({ price: r.price, below: r.below ? { price: r.below.price, name: r.below.id, type: r.below.type } : null, above: r.above ? { price: r.above.price, name: r.above.id, type: r.above.type } : null, gav: r.pos.gav });
    list.appendChild(el('li', { class: `ltrack-row${r.nearest <= 3 ? ' is-near' : ''}` }, [
      el('a', { class: 'ltrack-name', attrs: { href: `#/p/${encodeURIComponent(r.ticker)}` } }, [text('span', r.ticker)]),
      el('div', { class: 'ltrack-cell' }, [
        el('div', { class: 'ltrack-scale', attrs: { 'aria-hidden': 'true' } }, [text('span', r.below ? String(r.below.price) : ''), text('span', String(r.price), { class: 'ltrack-now' }), text('span', r.above ? String(r.above.price) : '')]),
        track,
        text('p', `${r.price} ${r.pos.currency} · ${words}`, { class: 'ltrack-words' }),
      ].filter(Boolean)),
    ]));
  }
  p.appendChild(list);
  p.appendChild(text('p', 'Left end: the nearest stop, invalidation or add level under the price. Right end: the nearest target over it. The small tick is the average cost.', { class: 'muted chart-caption' }));
  return p;
}

const LEVEL_CLS = { exit: 'is-exit', invalidation: 'is-exit', trim: 'is-trim', buy: 'is-buy', add: 'is-buy', watchpoint: 'is-watch' };

/** A dossier's price at each close, with its active levels and average cost drawn across. Null without a series. */
export function priceChartPanel({ ticker, levels, gav = null, currency, series }) {
  const all = series?.prices?.[ticker];
  if (!Array.isArray(all) || all.filter(isNum).length < 2) return null;
  const p = panel('Price and levels', 'each close');
  const body = el('div', { class: 'visual-body' });
  const draw = (count) => {
    while (body.firstChild) body.removeChild(body.firstChild);
    const from = Number.isFinite(count) ? Math.max(0, all.length - count) : 0;
    const values = all.slice(from);
    const sessions = series.sessions.slice(from);
    const shown = values.filter(isNum);
    const lo = Math.min(...shown);
    const hi = Math.max(...shown);
    // A level far outside the drawn prices would flatten the line, so only levels within reach of the range are drawn.
    const reach = (hi - lo || hi) * 1.6;
    const near = (v) => v >= lo - reach && v <= hi + reach;
    const marks = (levels ?? []).filter((l) => l.status === 'active' && isNum(l.price) && near(l.price)).map((l) => ({ value: l.price, name: `${SHORT[l.type] ?? l.type} ${l.price}`, cls: LEVEL_CLS[l.type] ?? '' }));
    if (isNum(gav) && near(gav)) marks.push({ value: gav, name: `cost ${gav}`, cls: 'is-gav' });
    const gaps = values.length - shown.length;
    body.appendChild(rangePicker(RANGES.filter((r) => !Number.isFinite(r.count) || r.count < all.length), count, draw));
    body.appendChild(lineChart({
      labels: sessions.map(shortDate), lines: [{ name: ticker, values, cls: 'is-a' }], marks, format: (n) => String(Number(n.toFixed(2))),
      summary: `${ticker} closes from ${shortDate(sessions[0])} to ${shortDate(sessions.at(-1))}: low ${lo}, high ${hi} ${currency}.`, height: 210,
    }));
    body.appendChild(text('p', `${shown.length} closes from ${shortDate(sessions[0])} to ${shortDate(sessions.at(-1))}: low ${lo}, high ${hi} ${currency}`
      + `${gaps ? `; ${gaps} with no confirmed price, left as a gap` : ''}.`, { class: 'muted chart-caption' }));
  };
  draw(all.length > 30 ? 30 : Infinity);
  p.appendChild(body);
  return p;
}
