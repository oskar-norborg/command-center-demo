// Journal (`#/journal`) and one entry (`#/journal/<id>`) — SPEC.md §5.6, §3.4, §3.4a, §3.4b, T4.1. Read-only: no
// editing controls anywhere. Outcome prices come from dist/data/outcomes.json (scripts/build-findings.js
// `buildOutcomes`), worked out at build time from the published close scans; the page never computes a price and the
// journal files never hold one. A price that is not a confirmed close is shown with ≈ and its basis, as everywhere else.
import { el, text, clear } from '../dom.js';
import { shortDate, todayEt } from '../data.js';
import { journalLine } from '../lib/journal.js';
import { scorecard } from '../lib/scorecard.js';

/** Shown when data/journal/ is empty (kept word for word from the placeholder the route had before T4.1). */
export const JOURNAL_PLACEHOLDER = 'No journal entries yet. Trades and holds appear here once a /log-trade pull request is merged.';

const signedPct = (n) => `${n > 0 ? '+' : ''}${n}%`;
const priceWithCurrency = (price, currency) => `${price}${currency ? ` ${currency}` : ''}`;

/** Newest first; on the same date, by id so the order is stable. */
function sortedEntries(journal) {
  return Object.values(journal ?? {}).sort((a, b) => (a.date === b.date ? String(b.id).localeCompare(String(a.id)) : a.date < b.date ? 1 : -1));
}

/** The first line of the reasoning section, as plain text (the section is the build's sanitised HTML). */
function firstLine(html) {
  if (!html) return '';
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return (holder.textContent ?? '').trim().split('\n')[0].trim();
}

/** What the outcomes are measured from: the fill, or a hold's reference close with its date (§3.4a). */
export function entryBasisText(outcome) {
  const e = outcome?.entry;
  if (!e) return '';
  if (e.kind === 'fill') return e.price === null ? 'no fill price' : `from fill ${priceWithCurrency(e.price, e.currency)}`;
  if (e.price === null) return `no reference close: ${e.reason ?? 'no close scan'}`;
  return `from reference close ${shortDate(e.date)}: ${e.basis ? '≈' : ''}${priceWithCurrency(e.price, e.currency)}${e.basis ? ` (${e.basis})` : ''}`;
}

/**
 * One chip's words: `90d: +12.4%`, `now: ≈+3.1% (intraday print, 29 Sep)`, `180d: due 12 Dec`, or the reason. A
 * horizon priced at an earlier close than its due date says which (`close 1 Jul`), so the date is never implied.
 */
export function outcomeChipText(label, point) {
  if (point.pending) return `${label}: due ${shortDate(point.due)}`;
  if (typeof point.change_pct !== 'number') return `${label}: — ${point.reason ?? 'no price'}`;
  const notes = [
    ...(point.approx && point.basis ? [point.basis] : []),
    ...(point.due && point.date && point.date !== point.due ? [`close ${shortDate(point.date)}`] : []),
  ];
  return `${label}: ${point.approx ? '≈' : ''}${signedPct(point.change_pct)}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

function outcomeChips(outcome) {
  const wrap = el('p', { class: 'journal-outcomes' });
  if (!outcome) return null;
  for (const h of outcome.horizons ?? []) wrap.appendChild(text('span', outcomeChipText(h.horizon, h), { class: 'chip' }));
  if (outcome.now) wrap.appendChild(text('span', outcomeChipText('now', outcome.now), { class: 'chip' }));
  if (!wrap.firstChild) return null;
  return wrap;
}

/** A grade badge per graded horizon, and `grade due <date>` in amber for one that is due and not graded (§5.6). */
function gradeBadges(entry, today) {
  const wrap = el('p', { class: 'journal-grades' });
  for (const g of entry.grades ?? []) {
    if (g.decision_quality && g.outcome) wrap.appendChild(text('span', `${g.horizon}: decision ${g.decision_quality}, outcome ${g.outcome}`, { class: 'chip' }));
    else if (g.due <= today) wrap.appendChild(text('span', `grade due ${shortDate(g.due)}`, { class: 'chip chip-amber' }));
  }
  return wrap.firstChild ? wrap : null;
}

/** The entry's headline: ticker and what it was, `units @ price`, `hold: <trigger>`, or the opening balance line. */
function headline(entry) {
  return `${entry.ticker} · ${journalLine(entry)}`;
}

function entryItem(entry, outcome, today) {
  const reasoning = firstLine(entry.sections?.reasoning_at_the_time);
  return el('li', { class: 'journal-entry' }, [
    el('h2', { class: 'journal-headline' }, [el('a', { attrs: { href: `#/journal/${encodeURIComponent(entry.id)}` }, text: headline(entry) })]),
    reasoning ? text('p', reasoning) : null,
    outcome ? text('p', entryBasisText(outcome), { class: 'muted' }) : null,
    outcomeChips(outcome),
    gradeBadges(entry, today),
  ]);
}

/** "3 of 4 your way, avg +5.2%" for one cell, or "—". The average is in the decision's favour: + means it paid. */
export function moveCellText(c) {
  if (!c.count) return '—';
  return `${c.yourWay} of ${c.count}, ${c.avg > 0 ? '+' : ''}${c.avg}%`;
}

/** The scorecard panel above the list (SPEC §5.6a). */
export function scorecardPanel(entries, outcomes, today) {
  const s = scorecard(entries, outcomes, today);
  if (!s.rows.length) return null;
  const panel = el('section', { class: 'panel journal-scorecard' }, [text('h2', 'Scorecard')]);
  const status = s.graded
    ? `${s.graded} grade${s.graded === 1 ? '' : 's'} given across ${s.decisions} decisions.`
    : `No decision graded yet across ${s.decisions} decisions.`;
  panel.appendChild(text('p', `${status}${s.due ? ` ${s.due} grade${s.due === 1 ? ' is' : 's are'} due.` : ''}${s.next ? ` Next grade due ${shortDate(s.next)}.` : ''}`, { class: s.due ? 'amber' : 'muted' }));
  const table = el('table', { class: 'grid' });
  table.appendChild(el('tr', {}, ['Decision', 'Entries', 'Decision grade', 'Outcome grade', 'Price your way: 90d', '180d', 'So far'].map((h) => text('th', h, { attrs: { scope: 'col' } }))));
  for (const r of s.rows) {
    table.appendChild(el('tr', {}, [
      text('th', r.label, { attrs: { scope: 'row' } }),
      text('td', String(r.entries)),
      text('td', r.decision ? `${r.decision} (${r.graded})` : '—'),
      text('td', r.outcome ?? '—'),
      text('td', moveCellText(r.d90)),
      text('td', moveCellText(r.d180)),
      text('td', moveCellText(r.now)),
    ]));
  }
  panel.appendChild(el('div', { class: 'grid-scroll' }, [table]));
  panel.appendChild(text('p', '"Your way" is up after a buy, add or hold, and down after a trim, a sale or staying out; the average is in the decision\'s favour, so + means it paid. Grades are averaged on A = 4 to D = 1. "So far" uses the newest close in this build.', { class: 'muted' }));
  return panel;
}

export function renderJournal(container, { state, outcomes }, nowMs = Date.now()) {
  clear(container);
  container.appendChild(text('h1', 'Journal'));
  const entries = sortedEntries(state?.journal);
  if (!entries.length) {
    container.appendChild(text('p', JOURNAL_PLACEHOLDER, { class: 'muted' }));
    return;
  }
  const today = todayEt(nowMs);
  const card = scorecardPanel(entries.filter((e) => e.action !== 'opening'), outcomes, today);
  if (card) container.appendChild(card);
  const list = el('ul', { class: 'journal-list' });
  for (const entry of entries) list.appendChild(entryItem(entry, outcomes?.[entry.id] ?? null, today));
  container.appendChild(list);
  container.appendChild(text('p', 'Outcomes are measured at the close scan on each date or the nearest earlier one; ≈ marks a price that is not a confirmed close.', { class: 'muted' }));
}

const TRADE_FIELDS = [
  ['account', 'Account'], ['units', 'Units'], ['price', 'Price'], ['currency', 'Currency'], ['fees', 'Fees'], ['fx_rate', 'USDNOK'],
  ['nok_value', 'NOK value'], ['gav_after', 'GAV after'], ['cash_after', 'Cash after'], ['level_ref', 'Level'], ['tax_note', 'Tax note'],
  ['tool_estimate_warning', 'Estimate warning'], ['trigger', 'Trigger'], ['gav', 'GAV'],
];

const SECTIONS = [
  ['reasoning_at_the_time', 'Reasoning at the time'], ['what_i_expected', 'What I expected'], ['grade_notes', 'Grade notes'], ['source', 'Source'],
];

function outcomeTable(outcome) {
  const table = el('table', { class: 'grid' });
  table.appendChild(el('tr', {}, ['When', 'Close scan', 'Price', 'Change'].map((h) => text('th', h, { attrs: { scope: 'col' } }))));
  const rowFor = (label, p) => el('tr', {}, [
    text('th', label, { attrs: { scope: 'row' } }),
    text('td', p.pending ? `due ${shortDate(p.due)}` : p.date ? shortDate(p.date) : '—'),
    text('td', typeof p.price === 'number' ? `${p.approx ? '≈' : ''}${priceWithCurrency(p.price, p.currency)}` : '—'),
    text('td', p.pending ? 'not yet' : typeof p.change_pct === 'number' ? `${p.approx ? '≈' : ''}${signedPct(p.change_pct)}${p.basis ? ` (${p.basis})` : ''}` : (p.reason ?? '—')),
  ]);
  for (const h of outcome.horizons ?? []) table.appendChild(rowFor(h.horizon, h));
  if (outcome.now) table.appendChild(rowFor('now', outcome.now));
  return table;
}

export function renderJournalEntry(container, { state, outcomes }, id, nowMs = Date.now()) {
  clear(container);
  const entry = state?.journal?.[id];
  if (!entry) {
    container.appendChild(text('h1', 'Journal'));
    container.appendChild(text('p', `No journal entry ${id}.`, { class: 'muted' }));
    container.appendChild(el('p', {}, [el('a', { attrs: { href: '#/journal' }, text: 'All journal entries' })]));
    return;
  }
  const outcome = outcomes?.[id] ?? null;
  container.appendChild(text('h1', headline(entry)));
  container.appendChild(el('p', {}, [el('a', { attrs: { href: '#/journal' }, text: 'All journal entries' })]));

  const facts = el('section', { class: 'panel' }, [text('h2', 'Entry')]);
  facts.appendChild(text('p', `${entry.date} · ${entry.action}`));
  const dl = el('dl', { class: 'journal-fields' });
  for (const [key, label] of TRADE_FIELDS) {
    if (entry[key] === undefined || entry[key] === null) continue;
    // `nok_value` holds the value in the book's base currency, so its label names that currency.
    dl.appendChild(text('dt', key === 'nok_value' ? `${state?.portfolio?.base_currency === 'USD' ? 'USD' : 'NOK'} value` : label));
    dl.appendChild(text('dd', String(entry[key])));
  }
  if (dl.firstChild) facts.appendChild(dl);
  container.appendChild(facts);

  if (entry.action !== 'opening') {
    const panel = el('section', { class: 'panel' }, [text('h2', 'Outcome')]);
    if (!outcome) panel.appendChild(text('p', 'no outcome prices in this build.', { class: 'muted' }));
    else {
      panel.appendChild(text('p', entryBasisText(outcome), { class: 'muted' }));
      panel.appendChild(el('div', { class: 'grid-scroll' }, [outcomeTable(outcome)]));
    }
    const badges = gradeBadges(entry, todayEt(nowMs));
    if (badges) panel.appendChild(badges);
    container.appendChild(panel);
  }

  for (const [key, label] of SECTIONS) {
    const html = entry.sections?.[key];
    if (!html) continue;
    container.appendChild(el('section', { class: 'panel' }, [text('h2', label), el('div', { html })]));
  }
}
