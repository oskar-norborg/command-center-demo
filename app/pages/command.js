// Command view (`#/`, and `#/positions` scrolled to the holdings) — SPEC.md §5.3, rewritten 2026-09-23 (the owner picked
// option B of docs/command-view-proposal.md with option A's holding rows). Top to bottom on a phone: the brief (what
// needs attention, headlines after the close on held names, the book line, what is new at this close, the day's
// moves, levels, what cleared), the book, the holdings, standing items, coming up, to-do. The page only displays:
// every number comes from the scan output or the state files, never from arithmetic here.
import { el, text, clear, scrollWrap, splitLayout } from '../dom.js';
import { hasScan, quoteView, money, signed, shortDate, isMorning, levelScan, levelsFromClose, todayEt, levelUnchecked, uncheckedReason, uncheckedNames, LABEL_GLYPH } from '../data.js';
import { ageChecks, reviewDue, sortHousekeeping } from '../../lib/housekeeping.js';
import { acct as acctName, ccy } from '../../lib/base-currency.js';
import { visualsOn } from '../components/charts.js';
import { bookChartPanel, levelTracksPanel } from './visuals.js';
import { bookBasisText, dayChangeExcludedText, unconfirmedPricesText } from '../../lib/values.js';
import { alertCard } from '../components/alert-card.js';
import { priceCell } from '../components/quote-price.js';
import { ring } from '../components/ring.js';
import { ringGauge, gaugeSizeForViewport } from '../components/ring-gauge.js';
import { freshnessOf } from '../components/scan-age.js';
import { pulseBudget } from '../lib/pulse-budget.js';
import { changeWords } from '../live-state.js';
import { heldCapPhrase, heldCapWords, previousCapPoints } from '../../lib/cap-alerts.js';
import { TYPE_WORD, levelPriceText, distanceWords, levelWords, nearestLevelState, isTrigger, bySeverity, closeChanges, heldNewsAfterClose, pickHeadlines, moves, priceNote } from '../lib/brief.js';

function panel(title, { cls = '', note = null } = {}) {
  const head = note ? el('div', { class: 'panel-head' }, [text('h2', title), text('span', note, { class: 'panel-note' })]) : text('h2', title);
  return el('section', { class: `panel${cls ? ` ${cls}` : ''}` }, [head]);
}

const sub = (title, nodes, cls = '') => el('div', { class: `brief-sec${cls ? ` ${cls}` : ''}` }, [text('h3', title, { class: 'brief-h' }), ...nodes]);
const chip = (label, kind = 'info') => text('span', label, { class: `chip hud-chip hud-chip-${kind}` });
const signedMoney = (n) => `${n > 0 ? '+' : ''}${money(n)}`;
// Holding rows show whole NOK so a phone row fits on its lines; the exact figure, to the øre, is the element's title.
const nok0 = (n) => Math.round(n).toLocaleString('en-US');
const signedNok0 = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${nok0(Math.abs(n))}`;
const signedPct = (n) => `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
const signClass = (n) => (n > 0 ? 'stat-positive' : n < 0 ? 'stat-negative' : '');
const ET_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etTime = (iso) => `${ET_HM.format(new Date(iso))} ET`;
const etDate = (iso) => ET_DAY.format(new Date(iso));

function tickerLink(ticker, state, cls = 'ticker-link') {
  const href = state?.positions?.[ticker] ? `#/p/${encodeURIComponent(ticker)}` : state?.watchlist?.[ticker] ? `#/w/${encodeURIComponent(ticker)}` : null;
  return href ? el('a', { class: cls, attrs: { href }, text: ticker }) : text('span', ticker, { class: cls });
}

// --- status dot (§5.3) -------------------------------------------------------------------------------------------

/** Status colour of a level type: green buy/add, amber trim, red exit/invalidation, cyan watchpoint. */
const TYPE_COLOUR = { buy: 'green', add: 'green', trim: 'amber', exit: 'red', invalidation: 'red', watchpoint: 'cyan' };
const COLOUR_RANK = { cyan: 0, green: 1, amber: 2, red: 3 };

/**
 * The status dot of a holding: `unchecked` when its price is unusable or every level was not evaluated (never cyan:
 * cyan means checked and nothing near); otherwise the strongest colour among its levels that are near or hit, by each
 * level's own type (a hit watchpoint is cyan, not red); cyan when nothing is near; grey when the scan has nothing for it.
 * @param {{id: string, state: string}[]|undefined} levelStates   the scan's states for the holding
 * @param {object[]} [levels]   the holding's levels from state, to know each one's type
 * @param {boolean} [priceUsable]   false when the holding's quote shows no price (failed, withheld, a range)
 */
export function statusDotFor(levelStates, levels = [], priceUsable = true) {
  if (!priceUsable) return 'unchecked';
  if (!levelStates) return 'grey';
  if (levelStates.length > 0 && levelStates.every(levelUnchecked)) return 'unchecked';
  let colour = 'cyan';
  for (const s of levelStates) {
    if (s.state !== 'near' && s.state !== 'hit') continue;
    const type = levels.find((l) => l.id === s.id)?.type;
    const c = TYPE_COLOUR[type] ?? 'cyan';
    if (COLOUR_RANK[c] > COLOUR_RANK[colour]) colour = c;
  }
  return colour;
}

// --- the book line and day change (§5.3, first shadow run) ---------------------------------------------------------

/** The day change as the Book panel has always worded it; null when there is none to state. */
function dayChangeText(b) {
  if (typeof b.day_change_nok !== 'number') return null;
  const scope = b.day_change_scope === 'stocks-only' ? 'stocks + cash' : b.day_change_scope;
  // ≈ when a name it measures is not priced at the session's confirmed close (pre-publish audit H1, 2026-09-24).
  return `${b.day_change_approximate === true ? '≈ ' : ''}${signed(b.day_change_nok)} ${ccy()} (${signed(b.day_change_pct, '%')}) day change — ${scope}`;
}

/** `Prices not at the close: ABC.OL from 2026-09-23 …`: what the book's `≈` stands for besides fund NAVs (H1), or null. */
function unconfirmedPricesLine(b) {
  const prices = unconfirmedPricesText(b.unconfirmed_prices);
  return prices ? `≈ Prices not at the close: ${prices}. Values, shares of the book and the day change that use them are approximate.` : null;
}

/** Nothing to measure is not a flat day: the scan sends null and says why, and the page says the same. */
function noDayChangeText(b) {
  return `Day change: ${b.day_change_reason === 'no-session' ? 'no session' : b.day_change_reason === 'no-baseline' ? 'not available (no baseline price)' : 'not available'}`;
}

/** `P&L against GAV +23,685.78 NOK (+10.12%): stocks … funds …`, from the scan's own `book.pnl`, or null. */
function pnlLine(b) {
  const p = b.pnl;
  if (!p?.stocks) return null;
  const part = (label, s) => (s ? `${label} ${signedMoney(s.pnl_nok)} (${signedPct(s.pnl_pct)})` : null);
  const approx = b.approximate ? '≈ ' : '';
  if (p.holdings) return `P&L against GAV ${approx}${signedMoney(p.holdings.pnl_nok)} ${ccy()} (${signedPct(p.holdings.pnl_pct)}): ${[part('stocks', p.stocks), part('funds', p.funds)].filter(Boolean).join(', ')}`;
  return `P&L against GAV: ${approx}${part('stocks', p.stocks)} ${ccy()}; funds not known`;
}

/** Which session priced the page, from the scan's own `run.sessions` (market hours never come from the browser). */
function sessionsLine(scan, state) {
  const names = { NYSE: 'NYSE', OSE: 'Oslo' };
  // An exchange nothing in the book or on the watchlist trades on is left out (the demo holds no Oslo name).
  const listed = [...Object.values(state?.positions ?? {}), ...Object.values(state?.watchlist ?? {})];
  const inUse = (x) => !state || x !== 'OSE' || listed.some((e) => e.exchange === 'OSE');
  const parts = Object.entries(scan.run?.sessions ?? {}).filter(([x]) => inUse(x)).map(([x, s]) => {
    const name = names[x] ?? x;
    if (s.state === 'closed') return `${name} did not trade on the run's day; its prices are the ${shortDate(s.date)} close`;
    return `${name} ${shortDate(s.date)} close${s.close_utc ? ` (${etTime(s.close_utc)})` : ''}`;
  });
  return parts.length ? `Prices: ${parts.join(' · ')}` : null;
}

// --- 1. The brief ---------------------------------------------------------------------------------------------------

const FILTER_TYPES = { sell: ['trim', 'exit', 'invalidation'], buy: ['buy', 'add'] };
const MOVE_WORD = { 'over-by-appreciation': 'over', over: 'over', clear: 'under' };

/** Names whose levels could not be checked: from the level scan, plus held names it could not value at all. */
function notCheckedNames(state, source) {
  const unchecked = uncheckedNames(source);
  for (const [ticker, position] of Object.entries(state?.positions ?? {})) {
    const hasActiveLevel = (position.levels ?? []).some((l) => l.status === 'active' || l.status === 'unresolved');
    if (hasActiveLevel && !source.positions?.[ticker] && !unchecked.some((u) => u.ticker === ticker)) {
      unchecked.push({ ticker, reason: source.quotes?.[ticker]?.failure_reason ?? 'no usable price' });
    }
  }
  return unchecked;
}

/** `Nearest: XYZ.OL inv 50 (13.5% above)`, from the level scan's position states, or null. */
function nearestText(state, source) {
  let best = null;
  for (const [ticker, sp] of Object.entries(source.positions ?? {})) {
    const ls = nearestLevelState(sp.levels);
    if (ls && (!best || Math.abs(ls.distance_pct) < Math.abs(best.ls.distance_pct))) best = { ticker, ls };
  }
  if (!best) return null;
  const level = state?.positions?.[best.ticker]?.levels?.find((l) => l.id === best.ls.id);
  if (!level) return `Nearest: ${best.ticker} ${best.ls.id}`;
  const words = distanceWords(best.ls, null, level);
  return `Nearest: ${best.ticker} ${level.type} ${levelPriceText(level)}${words ? ` (${words})` : ''}`;
}

function newsItem(n) {
  const li = el('li', { class: 'brief-news' });
  li.appendChild(/^https?:\/\//i.test(n.url ?? '') ? el('a', { attrs: { href: n.url, rel: 'noopener' }, text: n.title }) : text('span', n.title));
  const when = etDate(n.published);
  li.appendChild(text('span', ` ${n.source} · ${when === etDate(Date.now()) ? '' : `${shortDate(when)} `}${etTime(n.published)}`, { class: 'muted brief-news-meta' }));
  return li;
}

function briefPanel({ state, scan, lastClose, prevClose }, ctx) {
  const source = levelScan(scan, lastClose);
  const changes = source ? closeChanges(source, prevClose, state) : null;
  const p = panel(changes ? `Since the ${shortDate(changes.previousDate)} close` : 'Latest close', { cls: 'brief' });
  if (!hasScan(scan)) {
    p.appendChild(text('p', 'no scan yet — no triggers to show.', { class: 'muted' }));
    return { panel: p, changes: null };
  }
  if (ctx.freshness?.overdue) {
    p.appendChild(text('p', `This is the newest scan, but the ${shortDate(ctx.freshness.expected)} close is missing: everything below is ${ctx.freshness.age.replace(/ ago$/, '')} old.`, { class: 'brief-stale' }));
  }
  if (isMorning(scan)) {
    const closeDate = levelsFromClose(scan, lastClose);
    p.appendChild(text('p', closeDate ? `Morning run: levels are not evaluated. Triggers are from the ${shortDate(closeDate)} close.` : 'Morning run: levels are not evaluated, and there is no earlier close to show.', { class: 'amber' }));
  }

  // Needs attention: never scrolled past. Names not checked, then every high or medium trigger as a card; a voice
  // command's filter (SPEC.md §5.10) shows its matching level alerts here instead, whatever their severity.
  const attention = [];
  if (ctx.triggerFilter) {
    const clearLink = el('a', { attrs: { href: '#', role: 'button' }, text: 'show all' });
    clearLink.addEventListener('click', (e) => { e.preventDefault(); ctx.onClearTriggerFilter?.(); });
    attention.push(el('div', { class: 'trigger-filter-note chip chip-amber' }, [text('span', `Filtered: near a ${ctx.triggerFilter} level. `), clearLink]));
  }
  const unchecked = source ? notCheckedNames(state, source) : [];
  if (unchecked.length) {
    attention.push(el('div', { class: 'unchecked-note' }, [text('strong', 'Not checked: '), text('span', unchecked.map((u) => `${u.ticker} (${u.reason})`).join(' · '))]));
  }
  const triggers = source ? (source.alerts ?? []).filter(isTrigger).sort(bySeverity) : [];
  const wanted = ctx.triggerFilter ? FILTER_TYPES[ctx.triggerFilter] : null;
  const cards = wanted ? triggers.filter((a) => wanted.includes(a.level_type)) : triggers.filter((a) => a.severity === 'high' || a.severity === 'medium');
  for (const alert of cards) {
    const card = alertCard(alert, { state });
    // Pulse budget (SPEC.md §5.9, docs/phase3-plan.md §2.5): a hit on a card is a candidate; its grid dot shares the slot.
    if (alert.kind === 'hit') ctx.pulse.push({ key: card, eventKey: `${alert.ticker}:${alert.level_id ?? alert.kind}`, source: 'triggers', severity: alert.severity });
    attention.push(card);
  }
  if (wanted && cards.length === 0) attention.push(text('p', `No levels near or through a ${ctx.triggerFilter} level.`, { class: 'muted' }));
  if (attention.length) p.appendChild(sub('Needs attention', attention, 'brief-attention'));

  // Headlines on held names after the close that priced them: the most time-sensitive thing at 07:00 (on 23 Sep, a
  // US name's share offering). High-priority names list their newest three; the rest are counts linking to their dossiers.
  const news = heldNewsAfterClose({ scan, state, previous: prevClose });
  if (news && (news.high.length || news.others.length)) {
    const nodes = [];
    for (const group of news.high) {
      const q = quoteView(scan, group.ticker);
      const priced = q.kind === 'price' ? ` that priced it at ${q.price} ${q.currency}` : '';
      nodes.push(el('div', { class: 'brief-news-head' }, [
        tickerLink(group.ticker, state),
        text('span', news.mode === 'after-close' ? ` ${group.items.length} headline${group.items.length === 1 ? '' : 's'} after the ${etTime(group.since)} close${priced} · ${group.total} in 7 days` : ` ${group.items.length} headline${group.items.length === 1 ? '' : 's'} since the ${shortDate(etDate(news.since))} scan · ${group.total} in 7 days`, { class: 'muted' }),
      ]));
      nodes.push(el('ul', { class: 'plain-list brief-news-list' }, pickHeadlines(group.items, 3).map(newsItem)));
    }
    if (news.others.length) {
      nodes.push(el('p', { class: 'brief-others' }, [
        text('span', news.high.length ? 'Also: ' : ''),
        ...news.others.flatMap((o, i) => [i ? text('span', ' · ') : null, tickerLink(o.ticker, state), text('span', ` ${o.count}`)]),
        text('span', ' — newest on each dossier', { class: 'muted' }),
      ]));
    }
    p.appendChild(sub(news.mode === 'after-close' ? 'After the close · held names' : 'New headlines · held names', nodes, 'brief-news-sec'));
  }

  // The book in one line, and which closes priced it.
  const b = scan.book;
  const day = dayChangeText(b);
  p.appendChild(el('div', { class: 'brief-book' }, [
    text('span', `${b.approximate ? '≈ ' : ''}${money(b.total_nok)} ${ccy()}`, { class: 'brief-total' }),
    day ? text('span', day, { class: `brief-day ${signClass(b.day_change_nok)}` }) : text('span', noDayChangeText(b), { class: 'brief-day muted' }),
  ]));
  // On the first screen, not only in the Book panel: the prices behind this line's ≈ (pre-publish audit H1).
  // A scan from before #91 is not valued live: say whose holdings these are, never show them silently (#97).
  const asPublished = asPublishedNote(scan);
  if (asPublished) p.appendChild(text('p', asPublished, { class: 'amber brief-as-published' }));
  const unconfirmedBrief = unconfirmedPricesLine(b);
  if (unconfirmedBrief) p.appendChild(text('p', unconfirmedBrief, { class: 'amber brief-unconfirmed' }));
  const pnl = pnlLine(b);
  if (pnl) p.appendChild(text('p', pnl, { class: `brief-pnl ${signClass(b.pnl?.holdings?.pnl_nok ?? b.pnl?.stocks?.pnl_nok ?? 0)}` }));
  const sessions = sessionsLine(scan, state);
  if (sessions) p.appendChild(text('p', sessions, { class: 'muted brief-sessions' }));

  // New at this close: state changes and new triggers, one line each (never a second card for the same thing).
  if (changes) {
    const items = [];
    for (const c of changes.capChanges) {
      const approx = c.approximate ? '≈' : '';
      const line = c.to === 'clear'
        ? ` is back under its ${c.capPct}% cap: ${approx}${c.pctTo}% of book (was ${approx}${c.pctFrom}%, basis ${c.basis}).`
        : ` went ${MOVE_WORD[c.to]} its ${c.capPct}% cap${c.to === 'over-by-appreciation' ? ' by appreciation' : ''}: ${approx}${c.pctTo}% of book (was ${approx}${c.pctFrom}%, basis ${c.basis}).`;
      items.push(el('div', { class: 'brief-item' }, [chip('new', 'new'), tickerLink(c.ticker, state), text('span', line), c.rule ? text('span', ` Rule: ${c.rule}`, { class: 'muted' }) : null]));
    }
    for (const s of changes.stateChanges) {
      const lvl = s.level ? `${TYPE_WORD[s.level.type] ?? s.level.type} ${levelPriceText(s.level)}` : s.levelState.id;
      const now = s.to === 'not-evaluated' ? `not checked (${s.reason ?? 'not evaluated'})` : s.to;
      items.push(el('div', { class: 'brief-item' }, [chip('new', 'new'), tickerLink(s.ticker, state), text('span', ` ${lvl}: ${s.from} → ${now}`)]));
    }
    const capTickers = new Set(changes.capChanges.map((c) => c.ticker));
    const levelKeys = new Set(changes.stateChanges.map((s) => `${s.ticker}|${s.levelState.id}`));
    for (const a of changes.added) {
      if (a.kind === 'position-over-cap' && capTickers.has(a.ticker)) continue;
      if (a.level_id && levelKeys.has(`${a.ticker}|${a.level_id}`)) continue;
      if (a.severity === 'high' || a.severity === 'medium') continue;   // already a card under Needs attention
      items.push(el('div', { class: 'brief-item' }, [chip('new', 'new'), text('span', a.title)]));
    }
    if (items.length) p.appendChild(sub('New at this close', items));
  }

  // Moves: held names first, by their NOK part of the book's day change when the scan gives it; then the watchlist.
  const mv = moves(scan, state);
  if (mv.held.length || mv.watch.length) {
    // A move whose price is not the session's confirmed close carries ≈ and says what the price is (H1, 2026-09-24).
    const row = (r) => el('div', { class: `move${r.held ? ' is-held' : ''}${r.note ? ' is-approx' : ''}` }, [
      tickerLink(r.ticker, state, 'move-tk'),
      el('div', { class: 'move-track', attrs: { 'aria-hidden': 'true' } }, [el('div', { class: `move-bar ${r.pct >= 0 ? 'up' : 'down'}`, attrs: { style: `width:${mv.maxAbs > 0 ? (Math.abs(r.pct) / mv.maxAbs) * 50 : 0}%;${r.pct >= 0 ? 'left:50%' : 'right:50%'}` } })]),
      text('span', `${r.note ? '≈' : ''}${signed(r.pct, '%')}`, { class: `move-pct ${signClass(r.pct)}` }),
      text('span', r.nok !== null ? signedNok0(r.nok) : '', { class: `move-nok ${signClass(r.nok ?? 0)}`, attrs: r.nok !== null ? { title: `${signedMoney(r.nok)} ${ccy()}` } : {} }),
      r.note ? text('span', `≈ ${r.note}, not this close`, { class: 'move-note amber' }) : null,
    ].filter(Boolean));
    const closeDate = source ? shortDate(source.run.id.slice(0, 10)) : '';
    p.appendChild(sub(`Moves · ${closeDate} close`, [
      el('div', { class: 'move-head', attrs: { 'aria-hidden': 'true' } }, [text('span', mv.held.some((r) => r.nok !== null) ? `Held, by ${ccy()}` : 'Held'), text('span', 'day'), text('span', mv.held.some((r) => r.nok !== null) ? ccy() : '')]),
      ...mv.held.map(row),
      mv.watch.length ? el('div', { class: 'move-head', attrs: { 'aria-hidden': 'true' } }, [text('span', 'Watchlist'), text('span', ''), text('span', '')]) : null,
      ...mv.watch.map(row),
    ].filter(Boolean), 'brief-moves'));
  }

  // Levels: the all-clear in the words SPEC.md §5.3 fixed, or each info-severity level alert on one line with its
  // streak and where it was at the previous close; high and medium ones are cards above.
  if (source) {
    const lines = [];
    const levelAlerts = triggers.filter((a) => a.level_id && (a.kind === 'hit' || a.kind === 'near'));
    if (!ctx.triggerFilter && levelAlerts.length === 0) {
      const nearest = nearestText(state, source);
      const base = unchecked.length ? 'No levels near or through among the names checked.' : 'No levels near or through.';
      lines.push(text('p', `${base}${nearest ? ` ${nearest}` : ''}`, { class: 'muted' }));
    }
    const prio = (t) => state?.watchlist?.[t]?.priority ?? 99;
    for (const a of levelAlerts.filter((x) => x.severity === 'info').sort((x, y) => prio(x.ticker) - prio(y.ticker))) {
      // The level state from whichever scan section holds it, and the level from whichever state file has it: a name
      // can move between the watchlist and the positions after the scan (#92, a first buy), and a lookup in the wrong
      // section missed both, which printed the ticker twice and reset the streak.
      const findIn = (sections) => sections.map((s) => s?.[a.ticker]?.levels?.find((l) => l.id === a.level_id)).find(Boolean);
      const level = findIn([state?.positions, state?.watchlist]);
      const ls = findIn([source.positions, source.watchlist]);
      const was = changes?.previousAlert(a);
      const streak = ls?.hit_streak_sessions ?? 0;
      const line = el('div', { class: 'brief-item' }, [
        tickerLink(a.ticker, state),
        text('span', ` ${level ? levelWords(level, ls, a) : String(a.title ?? '').replace(new RegExp(`^${a.ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `), '')}`, { class: a.level_type === 'buy' || a.level_type === 'add' ? 'brief-zone' : '' }),
        a.kind === 'hit' ? text('span', streak > 1 ? ` · close ${streak} in the zone` : ' · first close in the zone') : null,
        was && typeof was.distance_pct === 'number' ? text('span', ` (was ${distanceWords(null, was)})`) : null,
        a.informational ? text('span', ` · ${a.funding_note ?? 'informational'}`, { class: 'muted' }) : null,
      ]);
      // A hit pulses on the close it first prints; after that it is standing, and stays still (reading, 2026-09-23).
      if (a.kind === 'hit' && streak <= 1) ctx.pulse.push({ key: line, eventKey: `${a.ticker}:${a.level_id}`, source: 'other' });
      lines.push(line);
    }
    if (lines.length) p.appendChild(sub('Levels', lines));
  }

  // Cleared: triggers the previous close raised that this one does not.
  const gone = changes ? changes.cleared : [];
  if (gone.length) {
    p.appendChild(sub('Cleared', gone.map((a) => text('div', a.kind === 'large-move'
      ? `${a.ticker}: the ${shortDate(changes.previousDate)} large move did not repeat (${a.title}).`
      : `${a.title} — not raised at this close.`, { class: 'brief-item muted' }))));
  }
  return { panel: p, changes };
}

// --- 2. The book --------------------------------------------------------------------------------------------------

/** Ring colours: three distinct hues (2026-09-23, the owner: the old cyan / cyan-dim pair looked alike). */
const ALLOCATION = [
  { key: 'funds', label: 'Funds', color: 'var(--cyan)' },
  { key: 'stocks', label: 'Stocks', color: 'var(--green)' },
  { key: 'cash', label: 'Cash', color: 'var(--text-muted)' },
];

function historyLine(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const W = 110;
  const H = 30;
  const ys = history.map((h) => h.total_nok);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const x = (i) => 2 + (i * (W - 4)) / (history.length - 1);
  const y = (v) => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6));
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  const line = document.createElementNS(svgNs, 'polyline');
  line.setAttribute('points', ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  line.setAttribute('class', 'spark-line');
  svg.appendChild(line);
  const shadow = history.some((h) => h.source === 'shadow');
  return el('div', { class: 'book-history' }, [
    svg,
    text('p', `Book at each close: ${money(first.total_nok)} ${ccy()} on ${shortDate(first.session)} → ${money(last.total_nok)} ${ccy()} on ${shortDate(last.session)} (${history.length} closes${shadow ? ', shadow runs included' : ''}; funds at their NAV dates)`, { class: 'muted' }),
  ]);
}

function bookPanel({ state, scan, history }) {
  const p = panel('Book');
  if (!hasScan(scan)) {
    p.appendChild(text('p', 'no scan yet — book value needs a scan run.', { class: 'muted' }));
    if (!state?.portfolio) return p;
    const rows = [];
    for (const fund of state.portfolio.funds ?? []) {
      const units = Object.entries(fund.units ?? {}).map(([a, u]) => `${a} ${u}`).join(' + ');
      const nav = state.marks?.navs?.[fund.id];
      const navText = !nav ? 'NAV —' : nav.status === 'needs-entry' ? 'NAV needs entry' : `NAV ${money(nav.nav)} (as of ${nav.as_of})`;
      rows.push(text('li', `${fund.name}: ${units} units, ${navText}`));
    }
    for (const [ticker, position] of Object.entries(state.positions ?? {})) rows.push(text('li', `${ticker}: ${position.units} units @ GAV ${money(position.gav)}`));
    if (rows.length) p.appendChild(el('ul', { class: 'plain-list' }, rows));
    const cash = Object.entries(state.marks?.cash ?? {}).map(([acct, c]) => `${acctName(acct)} ${money(c.nok)} ${ccy()}`).join(' · ');
    if (cash) p.appendChild(text('p', `Cash: ${cash}`, { class: 'muted' }));
    return p;
  }
  const b = scan.book;
  // No second total here (2026-09-24, the owner: "cut one of the two book totals... keep it at the top of the page,
  // where it belongs in a 'what changed' brief... have that panel show the breakdown only"). The brief above
  // already states it; this panel is the breakdown — day change, funds-as-of, P&L, allocation, by account, tech.
  const day = dayChangeText(b);
  if (day) {
    p.appendChild(text('p', day, { class: signClass(b.day_change_nok) || 'muted' }));
    // A day change that leaves names out says which; a partial number is never read as the whole book's.
    const left = dayChangeExcludedText(b.day_change_excluded);
    if (left) p.appendChild(text('p', `Day change does not measure: ${left}`, { class: 'amber' }));
  } else {
    p.appendChild(text('p', noDayChangeText(b), { class: 'muted' }));
  }
  // The oldest NAV date is always shown (D7); amber only when the book is approximate.
  p.appendChild(text('p', b.oldest_fund_nav_date ? `funds as of ${shortDate(b.oldest_fund_nav_date)}${b.approximate ? ' (approximate)' : ''}` : 'no fund NAV date', { class: b.approximate ? 'amber' : 'muted' }));
  const unconfirmed = unconfirmedPricesLine(b);
  if (unconfirmed) p.appendChild(text('p', unconfirmed, { class: 'amber' }));
  const pnl = pnlLine(b);
  if (pnl) p.appendChild(text('p', pnl, { class: 'book-pnl' }));

  // Appendix B: every percentage of book carries its basis date, and `≈` while the book is approximate.
  const approx = b.approximate ? '≈' : '';
  // The NAV date, and since the pre-publish audit (H1) every price that is not the session's confirmed close.
  const basis = bookBasisText(b);
  // The ring (SPEC.md §5.8/§5.9, kept with its spin): three distinct colours and each part labelled on the chart itself
  // (2026-09-23, the owner). The chart is decoration to a screen reader; the sentence under it says the same in words.
  p.appendChild(ringGauge({
    segments: ALLOCATION.map((a) => ({ pct: b.allocation[a.key], color: a.color })),
    labels: ALLOCATION.map((a) => ({ name: a.label, value: `${approx}${b.allocation[a.key]}%`, key: a.key })),
    key: 'book-allocation-ring',
    size: gaugeSizeForViewport(),
  }));
  const swatch = (cls) => el('span', { class: `alloc-swatch ${cls}`, attrs: { 'aria-hidden': 'true' } });
  p.appendChild(el('p', { class: 'muted alloc-sentence' }, [
    text('span', 'Allocation: '),
    swatch('alloc-swatch-funds'), text('span', `funds ${approx}${b.allocation.funds}%`),
    text('span', ' · '),
    swatch('alloc-swatch-stocks'), text('span', `stocks ${approx}${b.allocation.stocks}%`),
    text('span', ' · '),
    swatch('alloc-swatch-cash'), text('span', `cash ${approx}${b.allocation.cash}%`),
    text('span', ` (${basis})`),
  ]));
  p.appendChild(text('p', `By account: ${Object.entries(b.by_account).map(([a, v]) => `${acctName(a)} ${approx}${money(v)} ${ccy()}`).join(' · ')}`));
  const techRing = ring({ segments: [{ pct: b.tech_pct, color: b.tech_pct >= b.tech_cap_pct ? 'var(--amber)' : 'var(--cyan)' }], size: 40, thickness: 5, key: 'book-tech-ring' });
  techRing.setAttribute('aria-hidden', 'true');
  p.appendChild(el('div', { class: 'ring-row ring-row-small' }, [techRing, text('p', `Tech exposure: ${approx}${b.tech_pct}% of book (${basis}; cap ${b.tech_cap_pct}%)`, { class: 'muted' })]));
  const hist = historyLine(history);
  if (hist) p.appendChild(hist);
  return p;
}

// --- 3. Holdings (option A's rows) ----------------------------------------------------------------------------------

/** A price as glyph + number + currency; anything but a clean price falls back to the shared cell. */
function priceCompact(view) {
  if (view.kind !== 'price') return priceCell(view);
  return el('span', { class: 'price-cell hold-price', attrs: { title: view.label } }, [
    text('span', LABEL_GLYPH[view.label] ?? '', { class: 'glyph', attrs: { 'aria-label': view.label } }),
    text('span', String(view.price), { class: 'hold-price-num' }),
    text('span', ` ${view.currency}`, { class: 'hold-unit' }),
  ]);
}

/**
 * For a scan that is not valued live (no `book_inputs`, from before #91): the book and holdings are that close's, so
 * say so (#97: every figure is live or labelled with its close). Always amber: nothing checks whether the holdings
 * changed since. The check that worked them out from the scan's values (lib/book.js `inferredHoldingChanges`, amber
 * on a change, grey without) was removed on 2026-10-02, once the published scans carried `book_inputs`; such a scan
 * is now only a rollback or a local preview. Null for a live-valued scan.
 */
function asPublishedNote(scan) {
  if (!hasScan(scan) || scan.live || !scan.book) return null;
  return `Book and holdings as valued at the ${shortDate(String(scan.run.id).slice(0, 10))} close; trades or cash entered since are not in them yet.`;
}

/** The value cell of a holding the book could not value: a name bought after the scan has no price yet (#91). */
function noValueText(ticker, scan) {
  if (hasScan(scan) && scan.live && !scan.quotes?.[ticker]) return text('span', 'no price since the trade', { class: 'amber' });
  return text('span', '—');
}

function holdingRow(ticker, state, scan, levels, ctx) {
  const pos = state.positions[ticker];
  const sp = hasScan(scan) ? scan.positions?.[ticker] : null;
  const view = quoteView(scan, ticker);
  const scanPosition = hasScan(levels) ? levels.positions?.[ticker] : null;
  const priceUsable = view.kind === 'price' || view.kind === 'no-scan';
  const dot = statusDotFor(scanPosition?.levels, pos.levels, priceUsable);
  const hasLevels = (pos.levels ?? []).some((l) => l.status === 'active' || l.status === 'unresolved');
  const unchecked = (scanPosition?.levels ?? []).find(levelUnchecked) ?? (dot === 'unchecked' && hasLevels && hasScan(levels) ? { reason: view.reason ?? 'no usable price' } : null);
  // Priced at anything but the session's confirmed close (the scan's own list, pre-publish audit H1): value and P&L are ≈.
  const unconfirmedPrice = hasScan(scan) ? (scan.book?.unconfirmed_prices ?? []).find((e) => e.ticker === ticker) ?? null : null;
  const valueApprox = unconfirmedPrice ? '≈' : '';
  const note = view.kind === 'price' ? priceNote(scan, ticker, pos.exchange) : null;
  const row = el('div', { class: `hold-row${unchecked ? ' is-unchecked' : ''}`, attrs: { 'data-ticker': ticker } }, [
    el('div', { class: 'hold-tk' }, [tickerLink(ticker, state)]),
    el('div', { class: 'hold-val', attrs: sp ? { title: `${valueApprox}${money(sp.value_nok)} ${ccy()}` } : {} }, sp ? [text('span', `${valueApprox}${nok0(sp.value_nok)}`), text('span', ` ${ccy()}`, { class: 'hold-unit' })] : [noValueText(ticker, scan)]),
    el('div', { class: 'hold-br', attrs: { 'aria-hidden': 'true' } }),
    el('div', { class: 'hold-px' }, [priceCompact(view)]),
    text('div', view.kind === 'price' && view.change_pct != null ? `${note ? '≈' : ''}${signed(view.change_pct, '%')}` : '—', { class: `hold-chg ${signClass(view.kind === 'price' ? view.change_pct ?? 0 : 0)}` }),
    sp ? el('div', { class: `hold-pnl ${signClass(sp.pnl_nok)}`, attrs: { title: `${valueApprox}${signedMoney(sp.pnl_nok)} ${ccy()}` } }, [text('span', `${valueApprox}${signedNok0(sp.pnl_nok)}`), text('span', ` ${signedPct(sp.pnl_pct)}`)]) : text('div', '', { class: 'hold-pnl' }),
    el('div', { class: 'hold-br', attrs: { 'aria-hidden': 'true' } }),
  ]);
  const meta = el('div', { class: 'hold-meta' });
  const dotSpan = text('span', dot === 'unchecked' ? 'not checked' : dot, { class: `dot dot-${dot}`, attrs: { title: dot === 'unchecked' ? (unchecked ? uncheckedReason(unchecked) : view.reason ?? 'no usable price') : dot } });
  meta.appendChild(dotSpan);
  const held = heldCapWords({ sp, previous: previousCapPoints(ctx.prevClose)[ticker] ?? null });
  if (sp) meta.appendChild(el('span', { class: 'hold-wt' }, [text('span', `${sp.pct_approximate ? '≈' : ''}${sp.pct_of_book}% of book`), sp.cap_pct ? text('span', ` · cap ${sp.cap_pct}%`, { class: sp.cap_state === 'over' ? 'amber' : '' }) : null,
    // #94: a held-over cap state says why, in the badge itself
    held ? text('span', ` · held over: ${held.then}; clears below ${held.clears}%`, { class: 'hold-cap-held muted', attrs: { title: `Under the cap now, but within the ${held.band}-point hysteresis band, so the last close's state stands.` } }) : null]));
  if (unchecked) {
    meta.appendChild(text('span', `not checked: ${uncheckedReason(unchecked)}`, { class: 'amber hold-level', attrs: { title: uncheckedReason(unchecked) } }));
  } else {
    const nearest = nearestLevelState(scanPosition?.levels);
    const level = nearest ? (pos.levels ?? []).find((l) => l.id === nearest.id) : null;
    const alert = level ? (levels?.alerts ?? []).find((a) => a.ticker === ticker && a.level_id === level.id) ?? null : null;
    meta.appendChild(text('span', level ? `nearest: ${levelWords(level, nearest, alert)}` : hasLevels ? 'no level distance' : 'no levels set', { class: 'hold-level' }));
  }
  const hit = (scanPosition?.levels ?? []).find((l) => l.state === 'hit');
  if (hit && ctx.pulseEvents.has(`${ticker}:${hit.id}`)) ctx.pulse.push({ key: dotSpan, eventKey: `${ticker}:${hit.id}`, source: 'other' });
  if (note) meta.appendChild(chip(`≈ ${note}, not this close`, 'amber'));
  if (sp && sp.cap_state !== 'clear') meta.appendChild(chip(`over ${sp.cap_pct}% cap${sp.cap_state === 'over-by-appreciation' ? ' by appreciation' : ''}`, sp.cap_state === 'over' ? 'amber' : 'info'));
  if (ctx.changes?.capChanges.some((c) => c.ticker === ticker)) meta.appendChild(chip(`new since ${shortDate(ctx.changes.previousDate)}`, 'new'));
  if (sp?.no_adds?.state === 'active') meta.appendChild(chip(`no adds above ${sp.no_adds.above}: in force`, 'amber'));
  if (pos.review_by?.date) {
    // The review date (SPEC §5.3), red once it has passed. Evaluated against today's ET date in the browser, scan or no scan.
    const overdue = reviewDue({ today: todayEt(Date.now()), positions: { [ticker]: pos } }).find((r) => r.reason === 'overdue');
    meta.appendChild(text('span', overdue ? `review overdue (${shortDate(pos.review_by.date)})` : `review ${shortDate(pos.review_by.date)}`, { class: `hold-review${overdue ? ' red' : ' muted'}`, attrs: { 'data-review-overdue': overdue ? 'true' : 'false', ...(pos.review_by.note ? { title: pos.review_by.note } : {}) } }));
  }
  if (pos.news_priority === 'high' && hasScan(scan)) {
    const count = scan.news?.[ticker]?.length ?? 0;
    if (count) meta.appendChild(chip(`${count} headline${count === 1 ? '' : 's'} in 7 days`, 'news'));
  }
  row.appendChild(meta);
  return row;
}

function groupRow({ label, sub: subText, value, weight, pnl, meta }) {
  return el('div', { class: 'hold-row hold-group' }, [
    el('div', { class: 'hold-tk' }, [text('span', label, { class: 'hold-group-name' })]),
    el('div', { class: 'hold-val', attrs: value === null ? {} : { title: `${money(value)} ${ccy()}` } }, value === null ? [text('span', '—')] : [text('span', nok0(value)), text('span', ` ${ccy()}`, { class: 'hold-unit' })]),
    el('div', { class: 'hold-br', attrs: { 'aria-hidden': 'true' } }),
    text('div', subText, { class: 'hold-px hold-sub' }),
    text('div', '', { class: 'hold-chg' }),
    pnl ? el('div', { class: `hold-pnl ${signClass(pnl.pnl_nok)}`, attrs: { title: `${signedMoney(pnl.pnl_nok)} ${ccy()}` } }, [text('span', signedNok0(pnl.pnl_nok)), text('span', ` ${signedPct(pnl.pnl_pct)}`)]) : text('div', '', { class: 'hold-pnl' }),
    el('div', { class: 'hold-br', attrs: { 'aria-hidden': 'true' } }),
    el('div', { class: 'hold-meta' }, [weight ? text('span', weight, { class: 'hold-wt' }) : null, ...meta]),
  ]);
}

/** `14–15 Sep`, `30 Sep–1 Oct`, or one date. */
function navRange(first, last) {
  if (first === last) return shortDate(first);
  const [a, b] = [shortDate(first), shortDate(last)];
  return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]}–${b}` : `${a}–${b}`;
}

function holdingsPanel({ state, scan, lastClose }, ctx) {
  const p = panel('Holdings', { cls: 'holdings', note: `value · P&L against GAV, ${ccy()}` });
  const tickers = Object.keys(state?.positions ?? {});
  if (!tickers.length) {
    p.appendChild(text('p', 'No positions in state yet.', { class: 'muted' }));
    return p;
  }
  const levels = levelScan(scan, lastClose);
  p.appendChild(el('div', { class: 'hold-row hold-head', attrs: { 'aria-hidden': 'true' } }, [
    text('div', 'Name', { class: 'hold-tk' }), text('div', 'Value', { class: 'hold-val' }), text('div', 'Price', { class: 'hold-px' }),
    text('div', 'Day', { class: 'hold-chg' }), text('div', 'P&L against GAV', { class: 'hold-pnl' }),
  ]));
  const value = (t) => (hasScan(scan) ? scan.positions?.[t]?.value_nok ?? -1 : 0);
  for (const t of tickers.sort((a, b) => value(b) - value(a) || a.localeCompare(b))) p.appendChild(holdingRow(t, state, scan, levels, ctx));
  if (hasScan(scan)) {
    const b = scan.book;
    const approx = b.approximate ? '≈' : '';
    // What the holdings changed since this scan (#91): they are valued as they are now, at this scan's prices.
    const asPublished = asPublishedNote(scan);
    if (asPublished) p.appendChild(text('p', asPublished, { class: 'amber hold-live-note' }));
    const changed = changeWords(scan.live?.changes, (n) => money(n));
    if (changed.length) {
      p.appendChild(text('p', `Holdings as they are now, at the ${shortDate(scan.book_inputs.today)} prices. Changed since that scan: ${changed.join(' · ')}.`, { class: 'muted hold-live-note' }));
    }
    const funds = Object.entries(scan.funds ?? {});
    // NAV dates from the scan's fund rows, or, for a scan written before they existed, from marks.yaml itself.
    const navDates = (funds.length ? funds.map(([, f]) => f.nav_as_of) : Object.values(state.marks?.navs ?? {}).map((n) => n?.as_of)).filter(Boolean).sort();
    const fundList = funds.length ? el('details', { class: 'hold-funds' }, [
      el('summary', {}, [text('span', `${funds.length} funds`)]),
      el('ul', { class: 'plain-list hold-fund-list' }, funds.sort((x, y) => (y[1].value_nok ?? -1) - (x[1].value_nok ?? -1)).map(([id, f]) => {
        const name = state.portfolio?.funds?.find((x) => x.id === id)?.name ?? id;
        return el('li', {}, [
          text('span', name, { class: 'hold-fund-name' }),
          text('span', f.value_nok === null ? 'no NAV' : `${nok0(f.value_nok)} ${ccy()} · ${f.pct_of_book}%`, { class: f.value_nok === null ? 'amber' : '', attrs: f.value_nok === null ? {} : { title: `${money(f.value_nok)} ${ccy()}` } }),
          f.pnl_nok !== null ? text('span', ` ${signedNok0(f.pnl_nok)} ${signedPct(f.pnl_pct)}`, { class: signClass(f.pnl_nok) }) : null,
          text('span', f.nav_as_of ? ` · NAV ${shortDate(f.nav_as_of)}` : '', { class: 'muted' }),
        ]);
      })),
    ]) : null;
    p.appendChild(groupRow({
      label: 'Funds',
      sub: navDates.length ? `NAV ${navRange(navDates[0], navDates.at(-1))}` : 'NAV —',
      value: b.funds_nok, weight: `${approx}${b.allocation.funds}% of book`, pnl: b.pnl?.funds ?? null, meta: [fundList],
    }));
    const cash = Object.entries(state.marks?.cash ?? {});
    p.appendChild(groupRow({
      label: 'Cash',
      sub: cash[0]?.[1]?.as_of ? `as of ${shortDate(cash[0][1].as_of)}` : '',
      value: b.cash_nok, weight: `${approx}${b.allocation.cash}% of book`, pnl: null,
      meta: cash.map(([acct, c]) => {
        const floor = state.portfolio?.accounts?.[acct]?.cash_floor;
        const below = typeof floor === 'number' && c.nok < floor;
        return text('span', ` ${acctName(acct)} ${money(c.nok)}${below ? ` (below the ${money(floor)} floor)` : ''}`, { class: below ? 'amber' : '' });
      }),
    }));
  }
  const closeDate = levelsFromClose(scan, lastClose);
  if (closeDate) p.appendChild(text('p', `Nearest level and status are from the ${shortDate(closeDate)} close; prices are this morning's.`, { class: 'muted' }));
  return p;
}

// --- 4. Standing -----------------------------------------------------------------------------------------------------

function standingPanel({ state, scan, lastClose, prevClose }, changes) {
  const source = levelScan(scan, lastClose);
  if (!hasScan(scan) || !source) return null;
  const standing = changes ? changes.standing : (source.alerts ?? []).filter(isTrigger);
  const items = standing.filter((a) => a.severity === 'info' && !a.level_id);
  const lines = items.map((a) => {
    const sp = source.positions?.[a.ticker];
    if (a.kind === 'position-over-cap' && sp) {
      const rule = a.title.includes('rule: ') ? a.title.slice(a.title.indexOf('rule: ') + 6) : a.condition;
      // One wording for the card, this line and the badge (lib/cap-alerts.js, #94).
      const phrase = heldCapPhrase({ sp, previous: previousCapPoints(prevClose)[a.ticker] ?? null, unconfirmedPrices: source.book?.unconfirmed_prices ?? [] });
      if (phrase) return el('div', { class: 'brief-item' }, [tickerLink(a.ticker, state), text('span', ` ${phrase}.`), rule ? text('span', ` Rule: ${rule}`, { class: 'muted' }) : null]);
      return el('div', { class: 'brief-item' }, [tickerLink(a.ticker, state), text('span', ` over its ${sp.cap_pct}% cap${sp.cap_state === 'over-by-appreciation' ? ' by appreciation' : ''}: ${sp.pct_approximate ? '≈' : ''}${sp.pct_of_book}% of book (basis ${sp.pct_basis_date}).`), rule ? text('span', ` Rule: ${rule}`, { class: 'muted' }) : null]);
    }
    return text('div', a.title, { class: 'brief-item' });
  });
  for (const [t, sp] of Object.entries(source.positions ?? {})) {
    if (sp.no_adds?.state === 'active') lines.push(el('div', { class: 'brief-item' }, [tickerLink(t, state), text('span', ` no adds above ${sp.no_adds.above}: in force (close ${sp.no_adds.price}, ${shortDate(sp.no_adds.price_date)}).`)]));
  }
  if (!lines.length) return null;
  const p = panel(changes ? 'Unchanged' : 'Standing', { note: changes ? `as at the ${shortDate(changes.previousDate)} close` : null });
  lines.forEach((l) => p.appendChild(l));
  return p;
}

// --- 5. Coming up ---------------------------------------------------------------------------------------------------

function comingUpPanel({ state, scan }) {
  const p = panel('Coming up');
  const lines = [];
  if (hasScan(scan)) {
    for (const e of [...(scan.earnings ?? [])].filter((x) => x.days_away >= 0).sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push(text('p', `${e.ticker} earnings ${shortDate(e.date)} — ${e.days_away} d (${e.source}, ${e.confidence})`));
    }
  } else {
    const now = Date.now();
    for (const [ticker, entry] of Object.entries({ ...(state?.positions ?? {}), ...(state?.watchlist ?? {}) })) {
      const next = entry.earnings?.next;
      if (!next) continue;
      const days = Math.round((new Date(next).getTime() - now) / 86400000);
      if (days >= 0) lines.push(text('p', `${ticker} earnings ${next} (manual, ${days} d)`));
    }
  }
  for (const [ticker, position] of Object.entries(state?.positions ?? {})) {
    for (const c of position.catalysts ?? []) if (c.date) lines.push(text('p', `${ticker} ${c.name} ${shortDate(c.date)}`));
  }
  const noDate = [
    ...Object.entries(state?.positions ?? {}).flatMap(([t, pos]) => (pos.catalysts ?? []).filter((c) => !c.date).map((c) => `${t} ${c.name}`)),
    ...(hasScan(scan) ? (() => { const need = (scan.housekeeping ?? []).filter((h) => h.kind === 'earnings-date-needed' && h.reason === 'no-date').map((h) => h.ticker); return need.length ? [`earnings for ${need.join(', ')}`] : []; })() : []),
  ];
  if (!lines.length && !noDate.length) lines.push(text('p', hasScan(scan) ? 'No earnings or catalyst dates on record.' : 'No earnings dates recorded.', { class: 'muted' }));
  lines.forEach((l) => p.appendChild(l));
  if (noDate.length) p.appendChild(text('p', `No date yet: ${noDate.join(' · ')}`, { class: 'muted' }));
  return p;
}

// --- 6. To-do (housekeeping) ----------------------------------------------------------------------------------------

const FILE_FOR = {
  'fund-nav-stale': () => 'data/marks.yaml',
  'state-quiet': () => 'data/marks.yaml',
  'cash-stale': () => 'data/marks.yaml',
  'cash-below-floor': () => 'data/marks.yaml',
  'pending-action': () => 'data/portfolio.yaml',
  'courtage-unknown': () => 'data/portfolio.yaml',
  'courtage-unset': () => 'data/portfolio.yaml',
  'pipeline-hold-stale': () => 'data/portfolio.yaml',
  'holiday-calendar-missing': () => 'data/calendars/holidays.yaml',
  'catalyst-reminder': (h) => `data/positions/${h.ticker}.md`,
  'review-due': (h) => `data/positions/${h.ticker}.md`,
  'earnings-date-needed': (h, state) => (state?.watchlist?.[h.ticker] && !state?.positions?.[h.ticker] ? `data/watchlist/${h.ticker}.md` : `data/positions/${h.ticker}.md`),
  'thesis-needed': (h) => `data/positions/${h.ticker}.md`,
};

/**
 * `courtage-unknown` (scan, per account/market pair with a live buy/add hit) and `courtage-unset` (state-only,
 * every pair still null) both say "this pair's minimum courtage is unset" — `courtage-unknown`'s pairs are always
 * a subset of `courtage-unset`'s, since a hit needs the same null value. Folded into one checklist line per pair,
 * carrying the hit tickers when there are any, instead of two lines repeating the same fact.
 */
function mergeCourtageItems(items) {
  const unset = items.find((h) => h.kind === 'courtage-unset');
  const unknown = items.filter((h) => h.kind === 'courtage-unknown');
  if (!unset || !unknown.length) return items;
  const hitsByPair = new Map(unknown.map((h) => [`${h.account}/${h.market}`, h.tickers]));
  return items
    .filter((h) => h.kind !== 'courtage-unknown')
    .map((h) => (h === unset ? { ...h, hitsByPair } : h));
}

/** Wording of one scan housekeeping item, for the checklist. */
export function housekeepingText(h, state) {
  const fund = () => state?.portfolio?.funds?.find((f) => f.id === h.fund)?.name ?? h.fund;
  switch (h.kind) {
    case 'fund-nav-stale': return h.reason === 'needs-entry' ? `${fund()} NAV needs entry` : h.age_days == null ? `${fund()} NAV has no date` : `${fund()} NAV is ${h.age_days} d old`;
    case 'state-quiet': return `State not updated for ${h.age_days} d`;
    case 'cash-stale': return `${acctName(h.account)} cash entry is ${h.age_days} d old`;
    case 'cash-below-floor': return `${acctName(h.account)} cash ${money(h.cash)} ${ccy()} is below the ${money(h.floor)} ${ccy()} floor (buy hits informational)`;
    case 'earnings-date-needed': return h.reason === 'manual-date-passed' ? `${h.ticker}: earnings date ${h.manual_date} has passed, update it` : `${h.ticker}: earnings date needed`;
    case 'catalyst-reminder':
      return h.reason === 'no-date' ? `${h.ticker}: ${h.name} has no date yet`
        : h.reason === 'passed' ? `${h.ticker}: ${h.name} date ${h.date} has passed, update or remove it`
          : `${h.ticker}: ${h.name} ${h.days_away === 0 ? 'is today' : `is in ${h.days_away} d`} (${shortDate(h.date)})`;
    case 'review-due': {
      if (h.reason === 'no-date') return `${h.ticker}: no review date set`;
      const note = h.note ? ` — ${h.note}` : '';
      if (h.reason === 'overdue') return `${h.ticker} review overdue by ${h.days_overdue} day${h.days_overdue === 1 ? '' : 's'} (was due ${h.date})${note}`;
      return `${h.ticker} review ${h.days_away === 0 ? 'is due today' : `is due in ${h.days_away} d`} (${shortDate(h.date)})${note}`;
    }
    case 'pending-action': return `Pending action ${h.id} (${h.ticker}): trigger printed ${h.printed_on}; confirm or clear`;
    case 'holiday-calendar-missing': return `${h.exchange} ${h.year} holiday list is missing`;
    case 'llm-unavailable': return `LLM briefing unavailable (${h.reason})`;
    case 'courtage-unknown': return `Minimum courtage unknown for ${h.account}/${h.market} (${h.tickers.join(', ')})`;
    case 'thesis-needed': return `${h.ticker}: thesis not recorded yet`;
    case 'pipeline-hold-stale': {
      const at = (a) => `${a} cash ${money(state?.marks?.cash?.[a]?.nok)} ${ccy()} is at or above its ${money(state?.portfolio?.accounts?.[a]?.cash_floor)} ${ccy()} floor`;
      return `Position #2 pipeline still says on-hold, but ${h.accounts.map(at).join(' and ')} — update its status, or its reason if the hold is on purpose`;
    }
    case 'courtage-unset': {
      const pct = state?.portfolio?.rules?.courtage_warn_pct;
      const pairText = (pair) => {
        const hit = h.hitsByPair?.get(pair);
        return hit?.length ? `${pair} (hit: ${hit.join(', ')})` : pair;
      };
      return `Minimum courtage not recorded for ${h.pairs.map(pairText).join(', ')}${typeof pct === 'number' ? ` — the ${pct}% courtage check is skipped for them` : ''}`;
    }
    default: return h.ticker ? `${h.kind} (${h.ticker})` : h.kind;
  }
}

/** A link out to GitHub's editor for a state file. GitHub offers a direct commit to `main` there, and every change to
 * `data/` goes through a pull request (SPEC §5.12, the owner 2026-09-25), so the link carries the reminder into the editor. */
function fixLink(file, repo) {
  if (!file || !repo) return null;
  return el('a', {
    class: 'fix-link',
    attrs: { href: `https://github.com/${repo}/edit/main/${file}`, rel: 'noopener', title: 'Opens GitHub\'s editor. Save as a pull request, never a commit to main (docs/phone-editing.md).' },
    text: `edit ${file.replace(/^data\//, '')} (save as a PR)`,
  });
}

/** The items `ageChecks` makes from state alone: always judged here on the current state, never taken from a scan. */
const STATE_AGE_KINDS = new Set(['fund-nav-stale', 'state-quiet', 'cash-stale', 'cash-below-floor', 'catalyst-reminder', 'review-due']);

function todoPanel({ state, scan, config }) {
  // The dated checks on state (NAV, cash and state age, cash below its floor, catalysts, position reviews) are counted on the current
  // state to today's ET date in the browser, with or without a scan (lib/housekeeping.js, the scan's own function), so
  // a NAV or cash entry merged after the scan shows at once (#97: the scan's "cash below floor" contradicted the live
  // funding note). The scan adds only what needs its evidence (earnings dates, pending actions, courtage, calendars,
  // the LLM); then the state-only items the build worked out.
  const live = ageChecks({ today: todayEt(Date.now()), portfolio: state?.portfolio, marks: state?.marks, journal: Object.values(state?.journal ?? {}), positions: state?.positions });
  const datedItems = [...live, ...(hasScan(scan) ? (scan.housekeeping ?? []).filter((h) => !STATE_AGE_KINDS.has(h.kind)) : [])];
  const shown = new Set(datedItems.map((h) => `${h.kind}:${h.ticker ?? ''}`));
  const stateItems = (state?.housekeeping ?? []).filter((h) => !shown.has(`${h.kind}:${h.ticker ?? ''}`));
  const items = mergeCourtageItems(sortHousekeeping([...datedItems, ...stateItems]))
    .map((h) => ({ kind: h.kind, text: housekeepingText(h, state), file: FILE_FOR[h.kind]?.(h, state) ?? null, severity: h.severity, overdueReview: h.kind === 'review-due' && h.reason === 'overdue' }));
  // Medium and high items stay open and amber; info items fold behind one line (2026-09-23), their text unchanged.
  // An overdue position review is the one red line and comes first (the owner, 2026-11-09): a date that turns red when it passes.
  const loud = [...items.filter((i) => i.overdueReview), ...items.filter((i) => !i.overdueReview && (i.severity === 'medium' || i.severity === 'high'))];
  const quiet = items.filter((i) => !loud.includes(i));
  const p = panel('To-do', { note: items.length ? `${items.length} · ${loud.length ? `${loud.length} need attention` : 'none overdue'}` : null });
  if (!items.length) {
    p.appendChild(text('p', 'Nothing outstanding.', { class: 'muted' }));
    return p;
  }
  const li = (i) => {
    const node = text('li', i.text, { class: i.overdueReview ? 'hk-high hk-review-overdue red' : `hk-${i.severity}${i.severity === 'info' ? '' : ' amber'}` });
    const link = fixLink(i.file, config?.repo);
    if (link) { node.appendChild(text('span', ' — ')); node.appendChild(link); }
    return node;
  };
  if (loud.length) p.appendChild(el('ul', { class: 'plain-list' }, loud.map(li)));
  if (quiet.length) {
    const kinds = new Map();
    // An info `review-due` is the missing date, not a review that is due: the fold's summary says so.
    for (const i of quiet) { const label = i.kind === 'review-due' ? 'review date needed' : i.kind.replace(/-/g, ' '); kinds.set(label, (kinds.get(label) ?? 0) + 1); }
    const summary = [...kinds].map(([label, n]) => `${n} ${label}`).join(' · ');
    p.appendChild(el('details', { class: 'todo-quiet' }, [
      el('summary', {}, [text('span', `${quiet.length} info item${quiet.length === 1 ? '' : 's'}`), text('span', ` — ${summary}`, { class: 'muted' })]),
      el('ul', { class: 'plain-list' }, quiet.map(li)),
    ]));
  }
  return p;
}

// --- header status ---------------------------------------------------------------------------------------------

export function scanStatusLabel(scan) {
  if (!scan || !scan.run) return 'no scan';
  return scan.run.status.toUpperCase();
}

/**
 * @param {HTMLElement} container
 * @param {object} data   loadData()'s result
 * @param {{triggerFilter?: 'sell'|'buy'|null, onClearTriggerFilter?: () => void, focus?: 'holdings'|null}} [opts]
 *   `triggerFilter`: a voice command's transient filter (SPEC.md §5.10), consumed by this render only. `focus`: the
 *   bottom nav's Positions tab (`#/positions`) opens this same page scrolled to the holdings.
 */
export function renderCommand(container, data, { triggerFilter = null, onClearTriggerFilter, focus = null } = {}) {
  clear(container);
  container.classList.add('command-view');
  container.appendChild(text('h1', 'Command', { class: 'visually-hidden' }));
  const ctx = {
    triggerFilter, onClearTriggerFilter, pulse: [], pulseEvents: new Set(),
    freshness: hasScan(data.scan) ? freshnessOf(data, Date.now()) : null,
    prevClose: data.prevClose,   // the held-over cap explanation's "previous close" (#94)
  };
  const brief = briefPanel(data, ctx);
  ctx.changes = brief.changes;
  // A grid dot shares its event's pulse slot only when that event already pulses above (a card, or a first-close hit).
  for (const c of ctx.pulse) ctx.pulseEvents.add(c.eventKey);
  const holdings = holdingsPanel(data, ctx);
  const standing = standingPanel(data, brief.changes);
  // Phone order is this order; at ≥ 900px the brief and holdings form the main column and the rest the right rail.
  // Experimental visuals (components/charts.js): two more main-column panels, when they are switched on.
  const visuals = visualsOn(data.config) ? [bookChartPanel(data), levelTracksPanel(data)].filter(Boolean) : [];
  splitLayout(container, [
    [brief.panel, 'main'],
    [bookPanel(data), 'rail'],
    [holdings, 'main'],
    ...visuals.map((v) => [v, 'main']),
    ...(standing ? [[standing, 'rail']] : []),
    [comingUpPanel(data), 'rail'],
    [todoPanel(data), 'rail'],
  ]);
  // The page title is visually hidden, so the rail starts level with the brief (splitLayout reserves row 1 for it).
  const rail = container.querySelector(':scope > .layout-rail');
  const mainCount = 2 + visuals.length;
  container.style.gridTemplateRows = `repeat(${mainCount}, auto) 1fr`;
  if (rail) rail.style.gridRow = `1 / span ${mainCount + 1}`;
  const pulsing = pulseBudget(ctx.pulse);
  for (const candidate of ctx.pulse) if (pulsing.has(candidate.key)) candidate.key.classList.add('pulsing');
  if (focus === 'holdings' && typeof holdings.scrollIntoView === 'function') holdings.scrollIntoView({ block: 'start' });
}
