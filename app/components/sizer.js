// The position-size panel on a position or watchlist dossier (SPEC.md §5.4a). Type an entry and a stop (both start
// from the page's own numbers), pick a risk, and it shows the shares a stop-out loss of that share of the book allows,
// the order's size against the book and the cap, and the minimum courtage as a share of the order. Display only: it
// keeps the chosen risk in this browser and nothing else, and it never says to trade.
import { el, text } from '../dom.js';
import { money } from '../data.js';
import { DEFAULT_RISK_PCT, RISK_CHOICES, defaultStop, fxFor, sizeTrade } from '../lib/sizing.js';

const STORE_KEY = 'cc-risk-pct';

function storedRisk() {
  try {
    const v = Number(globalThis.localStorage?.getItem(STORE_KEY));
    return RISK_CHOICES.includes(v) ? v : DEFAULT_RISK_PCT;
  } catch {
    return DEFAULT_RISK_PCT;
  }
}

function storeRisk(v) {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, String(v));
  } catch {
    // Storage can be off (private mode, some embedded views); the choice then lasts for this page only.
  }
}

const num = (s) => {
  const n = Number(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

function field(label, value, name) {
  const input = el('input', { attrs: { type: 'number', inputmode: 'decimal', step: 'any', min: '0', name, 'aria-label': label } });
  if (value != null) input.value = String(value);
  return [el('label', { class: 'sizer-field' }, [text('span', label), input]), input];
}

/**
 * @param {object} a
 * @param {object} a.entry           the position or watchlist front matter (levels, currency, account, exchange, caps)
 * @param {number|null} a.price      the page's price, or null
 * @param {object} a.state           state.json
 * @param {object} a.scan            the scan the page shows
 * @param {number} [a.heldUnits]     units held, for a position
 * @param {string|null} [a.account]  the account an order would go in
 */
export function sizerPanel({ entry, price, state, scan, heldUnits = 0, account = null }) {
  const panel = el('section', { class: 'panel sizer' }, [text('h2', 'Position size')]);
  const base = state?.portfolio?.base_currency ?? 'NOK';
  const book = scan?.book?.total_nok;
  const rules = state?.portfolio?.rules ?? {};
  const buy = (entry.levels ?? []).find((l) => (l.type === 'buy' || l.type === 'add') && l.status === 'active' && typeof l.price === 'number');
  const startEntry = heldUnits ? (price ?? buy?.price ?? null) : (buy?.price ?? price ?? null);
  const start = defaultStop(entry.levels, startEntry);

  const [entryLabel, entryInput] = field(`Entry (${entry.currency})`, startEntry, 'entry');
  const [stopLabel, stopInput] = field(`Stop (${entry.currency})`, start?.price ?? null, 'stop');
  let risk = storedRisk();
  const riskGroup = el('div', { class: 'sizer-risk', attrs: { role: 'group', 'aria-label': 'Risk, % of book' } });
  const buttons = RISK_CHOICES.map((r) => {
    const b = text('button', `${r}%`, { class: 'chart-range', attrs: { type: 'button', 'data-risk': String(r) } });
    b.addEventListener('click', () => { risk = r; storeRisk(r); update(); });
    riskGroup.appendChild(b);
    return b;
  });
  panel.appendChild(el('div', { class: 'sizer-inputs' }, [entryLabel, stopLabel, el('div', { class: 'sizer-field' }, [text('span', 'Risk, % of book'), riskGroup])]));
  const source = text('p', '', { class: 'muted sizer-source' });
  const out = el('div', { class: 'sizer-out', attrs: { 'aria-live': 'polite' } });
  panel.appendChild(source);
  panel.appendChild(out);
  panel.appendChild(text('p', 'A sizing aid, not an order. The stop is judged on a daily close, so a gap past it loses more than shown.', { class: 'muted' }));
  if (entry.exchange === 'OSE') panel.appendChild(text('p', 'Reference price, verify on Nordnet before any order.', { class: 'muted' }));

  const fx = fxFor(entry.currency, base, scan);
  const approx = scan?.book?.approximate ? '≈' : '';

  function update() {
    for (const b of buttons) {
      const on = Number(b.dataset.risk) === risk;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const typedStop = num(stopInput.value);
    source.textContent = start && typedStop === start.price ? `Stop starts from the ${start.from}.` : !start && !stopInput.value ? 'No stop level on file: type the planned stop.' : '';
    out.replaceChildren();
    const r = sizeTrade({
      entry: num(entryInput.value), stop: typedStop, riskPct: risk, book, fx: fx ?? NaN,
      capPct: entry.caps?.max_pct_of_book ?? null, heldUnits,
      minCourtage: rules.min_courtage?.[account]?.[entry.exchange] ?? null, warnPct: rules.courtage_warn_pct ?? null, feeFloor: rules.fee_floor_per_buy_nok ?? null,
    });
    if (!r.ok) {
      out.appendChild(text('p', r.error, { class: 'amber' }));
      return;
    }
    const conv = entry.currency === base ? '' : ` (${money(Math.round(r.riskPerShare * fx * 100) / 100)} ${base})`;
    out.appendChild(el('p', { class: 'sizer-shares' }, [text('strong', `${r.shares} shares`), text('span', ` — a stop-out at ${num(stopInput.value)} loses ${approx}${money(r.loss)} ${base}: ${r.riskPerShare} ${entry.currency} a share${conv}, ${r.stopPct}% under the entry.`)]));
    out.appendChild(text('p', `Order ${approx}${money(r.order)} ${base}, ${approx}${r.orderPct}% of the book (${approx}${money(book)} ${base}).${r.afterPct !== null ? ` Position after: ${approx}${r.afterPct}% of the book.` : ''}`));
    if (r.limitedByCap) out.appendChild(text('p', `Held to ${r.byCap} by the ${entry.caps.max_pct_of_book}% cap; the risk alone would allow ${r.byRisk}.`, { class: 'amber' }));
    if (r.courtagePct !== null) out.appendChild(text('p', `Minimum courtage ${money(rules.min_courtage[account][entry.exchange])} ${base} is ${r.courtagePct < 0.01 ? 'under 0.01' : r.courtagePct}% of this order${r.courtageWarn ? `, over the ${rules.courtage_warn_pct}% warning` : ''}.`, { class: r.courtageWarn ? 'amber' : 'muted' }));
    const suggested = entry.suggested_size?.pct_of_book;
    if (!heldUnits && typeof suggested === 'number') out.appendChild(text('p', `Suggested size on file: ${entry.suggested_size.approximate ? '≈' : ''}${suggested}% of the book${r.orderPct > suggested ? '; this order is larger' : ''}.`, { class: r.orderPct > suggested ? 'amber' : 'muted' }));
    if (r.belowFeeFloor) out.appendChild(text('p', `Under the fee floor of ${money(rules.fee_floor_per_buy_nok)} ${base} per buy.`, { class: 'amber' }));
  }
  entryInput.addEventListener('input', update);
  stopInput.addEventListener('input', update);
  update();
  return panel;
}
