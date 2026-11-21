// Position dossier (`#/p/<TICKER>`) — SPEC.md §5.4. Levels render as the SVG
// level bar (§5.7) above a plain list of every level, retired ones included —
// function before visuals.
import { el, text, clear, scrollWrap, splitLayout } from '../dom.js';
import { acct as acctName, ccy } from '../../lib/base-currency.js';
import { quoteView, hasScan, money, signed, shortDate, todayEt, levelScan, levelsFromClose, levelUnchecked, uncheckedReason } from '../data.js';
import { levelBar } from '../components/level-bar.js';
import { priceCell, priceBlock } from '../components/quote-price.js';
import { pulseBudget } from '../lib/pulse-budget.js';
import { distanceWords, priceNote } from '../lib/brief.js';
import { journalLine } from '../lib/journal.js';
import { bookBasisText } from '../../lib/values.js';
import { reviewDue } from '../../lib/housekeeping.js';
import { dossierPin, watchHeader } from '../components/dossier-pin.js';
import { visualsOn } from '../components/charts.js';
import { priceChartPanel } from './visuals.js';
import { sizerPanel } from '../components/sizer.js';

export function levelLine(level, levelState) {
  const priceLabel =
    level.price != null
      ? String(level.price)
      : level.price_low != null
        ? `${level.price_low}–${level.price_high}`
        : (level.candidates ?? []).map((c) => `${c.price} (${c.label})`).join(' or ');
  // Condition first, action second, in the alert cards' words (Appendix B, §5.11): the line says what to check and
  // offers the action only as something to consider, never as a bare instruction (audit #22).
  const action = `Action to consider: ${level.action}`;
  const detail = level.condition ? `condition to check: ${level.condition} · ${action}` : action;
  const line = text('li', `${level.type} ${priceLabel} — ${detail}`, { class: `level level-${level.status}` });
  if (level.status === 'retired') {
    line.appendChild(text('span', ` retired ${level.retired_on}: ${level.retired_reason}`, { class: 'muted' }));
  }
  if (levelState && (levelState.state === 'hit' || levelState.state === 'near')) {
    // Worded like every other distance on the site, from the scan's own figure (2026-09-23): `hit (7.8% below)`.
    const words = distanceWords(levelState, null, level);
    line.appendChild(text('span', ` ${levelState.state}${words ? ` (${words})` : ''}`, { class: `chip level-state state-${levelState.state}` }));
  }
  if (levelUnchecked(levelState)) {
    // Never blank, never "clear": say that this level has not been compared with a price, and why (audit 2026-09-19, #2).
    line.appendChild(text('span', ` not checked: ${uncheckedReason(levelState)}`, { class: 'chip chip-amber level-state state-unchecked' }));
  }
  if (level.status === 'unresolved') {
    // §3.2: an unresolved level carries a persistent amber chip until it is resolved.
    line.appendChild(text('span', ` decision needed${level.decision_needed ? `: ${level.decision_needed}` : ''}`, { class: 'chip chip-amber' }));
  }
  return line;
}

/**
 * The position's review date and its note (SPEC §5.4), red once the date has passed. `today` is the ET date of the view,
 * so it turns red on the day whether or not a scan has run. Null with no date.
 * @param {{date?: string, note?: string|null}|null} reviewBy   the position's `review_by`
 * @param {string|null} today
 */
export function reviewLine(reviewBy, today) {
  if (!reviewBy?.date) return null;
  const item = today ? reviewDue({ today, positions: { x: { review_by: reviewBy } } })[0] : null;
  const state = item?.reason === 'overdue' ? `overdue by ${item.days_overdue} day${item.days_overdue === 1 ? '' : 's'}`
    : item?.reason === 'soon' ? (item.days_away === 0 ? 'due today' : `due in ${item.days_away} d`) : null;
  const node = text('p', `Review by ${reviewBy.date}${state ? ` — ${state}` : ''}${reviewBy.note ? `. ${reviewBy.note}` : ''}`, { class: `review-line${item?.reason === 'overdue' ? ' red' : item ? ' amber' : ''}` });
  node.dataset.reviewState = item?.reason ?? 'later';
  return node;
}

/**
 * The levels panel: the level bar (when any level has a price), then the list.
 * @param {object[]} levels
 * @param {number|null} gav
 * @param {{price?: number|null, states?: object[]}} [scan]  the scan's validated price and this ticker's level states
 */
export function levelsPanel(levels, gav, { price = null, states, statesFrom = null, reviewBy = null, today = null } = {}) {
  const p = el('section', { class: 'panel' }, [text('h2', 'Levels')]);
  if (gav != null) p.appendChild(text('p', `GAV: ${money(gav)}`, { class: 'muted' }));
  const review = reviewLine(reviewBy, today);
  if (review) p.appendChild(review);
  // A morning run evaluates no levels: say which close the states below are from (T2.13).
  if (statesFrom) p.appendChild(text('p', `Level states are from the ${shortDate(statesFrom)} close; this morning's run does not evaluate levels.`, { class: 'amber' }));
  if (!levels?.length) {
    p.appendChild(text('p', 'No levels set.', { class: 'muted' }));
    return p;
  }
  const unchecked = (Array.isArray(states) ? states : []).find(levelUnchecked);
  if (unchecked) p.appendChild(text('p', `Not checked: ${uncheckedReason(unchecked)}. These levels have not been compared with a price, so nothing below says they are clear.`, { class: 'amber' }));
  const bar = levelBar({ levels, gav, price, states });
  if (bar) {
    // Pulse budget (SPEC.md §5.9, §2.5 resolution 1): a dossier's own hit levels always pulse on their own page —
    // there is nothing else here to compete with (no Triggers panel), so every `is-hit` marker is a candidate and
    // the shared budget (capped at 3 regardless) decides for consistency with the command view's rule, not because
    // one ticker is likely to have more than 3 hits at once.
    const hitMarkers = [...bar.querySelectorAll('.level-marker.is-hit')];
    const pulsing = pulseBudget(hitMarkers.map((node) => ({ key: node, eventKey: node.dataset.levelId, source: 'other' })));
    for (const node of hitMarkers) if (pulsing.has(node)) node.classList.add('pulsing');
    p.appendChild(bar);
  }
  const byId = new Map((Array.isArray(states) ? states : []).map((st) => [st.id, st]));
  p.appendChild(el('ul', { class: 'plain-list' }, levels.map((l) => levelLine(l, byId.get(l.id)))));
  return p;
}

function metricsPanel(metrics) {
  const p = el('section', { class: 'panel' }, [text('h2', 'Key metrics')]);
  if (!metrics?.length) {
    p.appendChild(text('p', 'not recorded', { class: 'muted' }));
    return p;
  }
  const table = el('table', { class: 'grid' });
  table.appendChild(el('tr', {}, ['Metric', 'Value', 'As of', 'Source'].map((h) => text('th', h))));
  for (const m of metrics) {
    table.appendChild(
      el('tr', {}, [
        text('td', m.name),
        text('td', String(m.value)),
        text('td', m.as_of ?? 'not recorded'),
        text('td', m.source ?? 'not recorded'),
      ])
    );
  }
  p.appendChild(scrollWrap(table));
  return p;
}

const isWebUrl = (u) => /^https?:\/\//i.test(u ?? '');

function newsList(items) {
  return el('ul', { class: 'plain-list' }, items.map((n) => {
    const li = el('li');
    li.appendChild(isWebUrl(n.url) ? el('a', { attrs: { href: n.url, rel: 'noopener' }, text: n.title }) : text('span', n.title));
    li.appendChild(text('span', ` — ${n.source}, ${shortDate(String(n.published).slice(0, 10))}`, { class: 'muted' }));
    return li;
  }));
}

function findingsPanel(ticker, findings, scan) {
  const p = el('section', { class: 'panel' }, [text('h2', 'Recent scan findings')]);
  const runs = findings?.[ticker];
  if (runs?.length) {
    p.appendChild(el('ul', { class: 'plain-list' }, runs.map((r) => {
      const q = r.quote ?? {};
      const kind = q.price != null && q.label !== 'fetch failed' ? 'price' : typeof q.price_low === 'number' ? 'range' : 'unavailable';
      const view = { kind, ...q, low: q.price_low, high: q.price_high, reason: q.failure_reason };
      const li = el('li', { class: 'finding' }, [text('strong', `${shortDate(r.date)} ${r.type}`), text('span', ' '), priceCell(view)]);
      if (r.quote?.label) li.appendChild(text('span', ` ${r.quote.label}`, { class: 'muted' }));
      for (const a of r.alerts ?? []) li.appendChild(text('div', a.title, { class: `finding-alert sev-${a.severity}` }));
      return li;
    })));
  } else if (hasScan(scan)) {
    const alerts = (scan.alerts ?? []).filter((a) => a.ticker === ticker);
    if (alerts.length) p.appendChild(el('ul', { class: 'plain-list' }, alerts.map((a) => text('li', a.title))));
    else p.appendChild(text('p', 'no findings for this name in the latest scan.', { class: 'muted' }));
  } else {
    p.appendChild(text('p', 'no scan history yet.', { class: 'muted' }));
  }
  const news = hasScan(scan) ? scan.news?.[ticker] : runs?.[0]?.news;
  if (news?.length) {
    p.appendChild(text('h3', 'News'));
    p.appendChild(newsList(news));
  }
  return p;
}

function journalPanel(state, ticker) {
  const p = el('section', { class: 'panel' }, [text('h2', 'Journal')]);
  const entries = Object.values(state.journal ?? {}).filter((j) => j.ticker === ticker);
  if (!entries.length) {
    p.appendChild(text('p', 'no journal entries yet.', { class: 'muted' }));
    return p;
  }
  for (const j of entries.sort((a, b) => (a.date < b.date ? 1 : -1))) {
    p.appendChild(el('p', {}, [el('a', { attrs: { href: `#/journal/${encodeURIComponent(j.id)}` }, text: journalLine(j) })]));
  }
  return p;
}

/**
 * The position's `caps.no_adds_above` rule, and whether the scan found it in force (display only, audit #8). The state
 * comes from the scan the levels come from, so a morning run shows the last close's, dated.
 * @param {number} above   `caps.no_adds_above` from the position file
 * @param {object|undefined} state   the scan's `positions[t].no_adds`
 */
export function noAddsLine(above, state) {
  const rule = `No adds above ${above}`;
  if (!state || state.above !== above) return text('p', rule, { class: 'muted' });
  if (state.state === 'not-evaluated') return text('p', `${rule}: not checked (${state.reason ?? 'no usable close'})`, { class: 'muted' });
  const close = `close ${state.price}${state.price_date ? `, ${shortDate(state.price_date)}` : ''}`;
  return state.state === 'active'
    ? text('p', `${rule}: in force (${close})`, { class: 'amber' })
    : text('p', `${rule}: not in force (${close})`, { class: 'muted' });
}

export function renderPosition(container, { state, scan, findings, lastClose, series, config }, ticker) {
  clear(container);
  const position = state?.positions?.[ticker];
  if (!position) {
    container.appendChild(text('p', `No position found for "${ticker}".`, { class: 'muted' }));
    return;
  }

  const view = quoteView(scan, ticker);
  const header = el('header', { class: 'dossier-header' }, [
    text('h1', `${ticker} — ${position.name}`),
    text('span', acctName(position.account), { class: 'chip' }),
  ]);
  // A price that is not the session's confirmed close says what it is, and its day change carries ≈ (pre-publish audit H1).
  const note = view.kind === 'price' ? priceNote(scan, ticker, position.exchange) : null;
  for (const node of priceBlock(view, ticker, note)) header.appendChild(node);
  container.appendChild(header);
  const pin = dossierPin(ticker, view, note);
  container.appendChild(pin);
  watchHeader(header, pin);

  const levels = levelsPanel(position.levels, position.gav, {
    price: view.kind === 'price' ? view.price : null,
    states: hasScan(levelScan(scan, lastClose)) ? levelScan(scan, lastClose).positions?.[ticker]?.levels : undefined,
    statesFrom: levelsFromClose(scan, lastClose),
    reviewBy: position.review_by ?? null,
    today: todayEt(Date.now()),
  });

  const scanPosition = hasScan(scan) ? scan.positions?.[ticker] : null;
  const tile = el('section', { class: 'panel' }, [
    text('h2', 'Position'),
    text('p', `Units: ${position.units}`),
    text('p', `GAV: ${money(position.gav)} (as of ${position.gav_as_of})`),
  ]);
  if (scanPosition) {
    // Value, P&L and % of book below come from the price the scan says it used. A last good price is not today's, so say so.
    const priced = scanPosition.priced;
    const unconfirmed = (scan.book?.unconfirmed_prices ?? []).find((e) => e.ticker === ticker) ?? null;
    const approx = unconfirmed ? '≈' : '';
    if (priced?.source === 'last-good') {
      tile.appendChild(text('p', `Priced at last good ${priced.price} ${position.currency}${priced.as_of ? ` (${shortDate(priced.as_of)})` : ' (date unknown)'}: no usable quote today, so the value, P&L and % of book below use it.`, { class: 'amber' }));
    } else if (unconfirmed) {
      tile.appendChild(text('p', `Priced at ${priced?.price ?? '—'} ${position.currency}, ${priceNote(scan, ticker, position.exchange) ?? 'not the close'}, not this close: the value, P&L and % of book below are approximate.`, { class: 'amber' }));
    }
    tile.appendChild(text('p', `Value: ${approx}${money(scanPosition.value_nok)} ${ccy()}`));
    tile.appendChild(text('p', `P&L: ${approx}${signed(scanPosition.pnl_nok)} ${ccy()} (${signed(scanPosition.pnl_pct, '%')})`));
    // SPEC §4.6: a USD name's cost is valued at today's USDNOK, so this P&L is the USD move restated in NOK. It carries no
    // currency gain or loss and is not the tax basis (the journal's fx_rate is).
    if (position.currency === 'USD' && ccy() === 'NOK') {
      tile.appendChild(text('p', "P&L is the USD price move restated in NOK: cost is valued at today's USDNOK, so it shows no currency effect and is not the tax cost.", { class: 'muted' }));
    }
    tile.appendChild(
      text(
        'p',
        `% of book: ${scanPosition.pct_approximate ? '≈' : ''}${scanPosition.pct_of_book}% (${bookBasisText({ oldest_fund_nav_date: scanPosition.pct_basis_date, unconfirmed_prices: scan.book?.unconfirmed_prices })})`
      )
    );
    // Why the state is what it is (audit #7): held from the last close inside the hysteresis band, or how "by
    // appreciation" was told apart from "over" when the journal is empty.
    const capWhy = scanPosition.cap_held ? ' (held from the last close: back under the cap, inside the hysteresis band)'
      : scanPosition.cap_basis === 'cost-basis' ? ' (no journal: judged on units × GAV as a share of the book)' : '';
    tile.appendChild(text('p', `Cap state: ${scanPosition.cap_state}${capWhy}`));
  } else {
    tile.appendChild(text('p', 'value/P&L need a scan run.', { class: 'muted' }));
  }
  if (typeof position.caps?.no_adds_above === 'number') {
    const closeScan = levelScan(scan, lastClose);
    tile.appendChild(noAddsLine(position.caps.no_adds_above, hasScan(closeScan) ? closeScan.positions?.[ticker]?.no_adds : undefined));
  }
  const reportsPanel = el('section', { class: 'panel' }, [text('h2', 'Reports')]);
  if (position.reports?.length) {
    reportsPanel.appendChild(el('ul', { class: 'plain-list' }, position.reports.map((r) => text('li', r))));
  } else {
    reportsPanel.appendChild(text('p', 'No reports linked.', { class: 'muted' }));
  }

  const footer = el('footer', { class: 'dossier-footer' });
  footer.appendChild(text('p', position.tax_note ?? 'No tax note.'));
  if (position.caps?.rule) footer.appendChild(text('p', position.caps.rule));
  if (position.earnings?.rule) footer.appendChild(text('p', position.earnings.rule));

  // SPEC.md §5.4 order on the phone; on desktop findings, journal and reports move to the right rail (layout pass, option A).
  const chart = visualsOn(config) ? priceChartPanel({ ticker, levels: position.levels, gav: position.gav, currency: position.currency, series }) : null;
  splitLayout(container, [
    [levels, 'main'],
    ...(chart ? [[chart, 'main']] : []),
    [tile, 'main'],
    [sizerPanel({ entry: position, price: view.kind === 'price' ? view.price : null, state, scan, heldUnits: position.units, account: position.account }), 'main'],
    [el('section', { class: 'panel' }, [text('h2', 'Thesis'), el('div', { html: position.sections?.thesis ?? '' })]), 'main'],
    [el('section', { class: 'panel' }, [
      text('h2', 'What would break it'),
      el('div', { html: position.sections?.what_would_break_it ?? '' }),
    ]), 'main'],
    [metricsPanel(position.metrics), 'main'],
    [findingsPanel(ticker, findings, scan), 'rail'],
    [el('section', { class: 'panel' }, [text('h2', 'Notes'), el('div', { html: position.sections?.notes ?? '' })]), 'main'],
    [journalPanel(state, ticker), 'rail'],
    [reportsPanel, 'rail'],
    [footer, 'full'],
  ]);
}
