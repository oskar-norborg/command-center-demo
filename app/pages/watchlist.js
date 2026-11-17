// Watchlist overview (`#/watchlist`) and dossier (`#/w/<TICKER>`) — SPEC.md
// §5.5. Same price, level bar and level list as the position dossier.
import { el, text, clear, scrollWrap, splitLayout } from '../dom.js';
import { acct as acctName, ccy } from '../../lib/base-currency.js';
import { quoteView, hasScan, levelScan, levelsFromClose, levelUnchecked, uncheckedReason, shortDate } from '../data.js';
import { levelWords } from '../lib/brief.js';
import { priceCell, priceBlock } from '../components/quote-price.js';
import { levelsPanel } from './position.js';
import { dossierPin, watchHeader } from '../components/dossier-pin.js';
import { visualsOn } from '../components/charts.js';
import { priceChartPanel } from './visuals.js';

/**
 * The buy level cell (moved here from the command view's watchlist strip, 2026-09-23): the distance in the scan's own
 * words (`7.8% below buy 138`, the same figure the alert prints), or "not checked" with the reason, or "—".
 */
function buyLevelCell(ticker, entry, levels) {
  const buy = (entry.levels ?? []).find((l) => l.type === 'buy' && l.status !== 'retired');
  if (!buy) return text('td', '—');
  const buyState = hasScan(levels) ? levels.watchlist?.[ticker]?.levels?.find((l) => l.id === buy.id) : null;
  if (levelUnchecked(buyState)) return text('td', `buy ${buy.price ?? `${buy.price_low}–${buy.price_high}`} — not checked`, { class: 'amber', attrs: { title: uncheckedReason(buyState) } });
  const alert = hasScan(levels) ? (levels.alerts ?? []).find((a) => a.ticker === ticker && a.level_id === buy.id) ?? null : null;
  const cell = text('td', levelWords(buy, buyState, alert));
  if (buyState?.state === 'hit') cell.appendChild(text('span', buyState.hit_streak_sessions > 1 ? ` · close ${buyState.hit_streak_sessions} in the zone` : ' · first close in the zone', { class: 'muted' }));
  return cell;
}

export function renderWatchlist(container, { state, scan, lastClose }) {
  clear(container);
  container.appendChild(text('h1', 'Watchlist'));
  const entries = Object.entries(state?.watchlist ?? {}).sort(
    (a, b) => (a[1].priority ?? Infinity) - (b[1].priority ?? Infinity)
  );
  if (!entries.length) {
    container.appendChild(text('p', 'Watchlist is empty.', { class: 'muted' }));
    return;
  }
  const levels = levelScan(scan, lastClose);
  const table = el('table', { class: 'grid grid-watchlist-overview' });
  table.appendChild(
    el('tr', {}, ['Ticker', 'Price', 'Buy level', 'Priority', 'Name', 'Target', 'Bench'].map((h) => text('th', h)))
  );
  for (const [ticker, entry] of entries) {
    table.appendChild(
      el('tr', {}, [
        el('td', { class: 'ticker-cell' }, [el('a', { attrs: { href: `#/w/${encodeURIComponent(ticker)}` }, text: ticker })]),
        el('td', {}, [priceCell(quoteView(scan, ticker))]),
        buyLevelCell(ticker, entry, levels),
        text('td', entry.priority ?? '—'),
        text('td', entry.name),
        text('td', acctName(entry.target_account)),
        text('td', entry.bench ? 'yes' : 'no'),
      ])
    );
  }
  container.appendChild(scrollWrap(table));
  const closeDate = levelsFromClose(scan, lastClose);
  if (closeDate) container.appendChild(text('p', `Buy levels are from the ${shortDate(closeDate)} close; prices are this morning's.`, { class: 'muted' }));
}

export function renderWatchlistDossier(container, { state, scan, lastClose, series, config }, ticker) {
  clear(container);
  const entry = state?.watchlist?.[ticker];
  if (!entry) {
    container.appendChild(text('p', `No watchlist entry found for "${ticker}".`, { class: 'muted' }));
    return;
  }

  const view = quoteView(scan, ticker);
  const header = el('header', { class: 'dossier-header' }, [
    text('h1', `${ticker} — ${entry.name}`),
    text('span', acctName(entry.target_account), { class: 'chip' }),
  ]);
  for (const node of priceBlock(view, ticker)) header.appendChild(node);
  container.appendChild(header);
  const pin = dossierPin(ticker, view);
  container.appendChild(pin);
  watchHeader(header, pin);

  const levels = levelsPanel(entry.levels, null, {
    price: view.kind === 'price' ? view.price : null,
    states: hasScan(levelScan(scan, lastClose)) ? levelScan(scan, lastClose).watchlist?.[ticker]?.levels : undefined,
    statesFrom: levelsFromClose(scan, lastClose),
  });

  const info = el('section', { class: 'panel' }, [
    text('h2', 'Watch details'),
    text('p', `Priority: ${entry.priority ?? 'not ranked'}`),
    text('p', `Constraints: ${entry.constraints ?? 'none'}`),
    text(
      'p',
      entry.suggested_size
        ? `Suggested size: ${entry.suggested_size.approximate ? '≈' : ''}${entry.suggested_size.pct_of_book}% of book (${entry.suggested_size.nok} ${ccy()})`
        : 'Suggested size: not set'
    ),
    text('p', entry.bench ? 'On the Position #2 pipeline bench.' : 'Not on the Position #2 bench.'),
  ]);

  // SPEC.md §5.5 order on the phone; on desktop watch details and notes move to the right rail (layout pass, option A).
  const items = [
    [levels, 'main'],
    [info, 'rail'],
    [el('section', { class: 'panel' }, [
      text('h2', "Why I'm watching"),
      el('div', { html: entry.sections?.why_watching ?? '' }),
    ]), 'main'],
    [el('section', { class: 'panel' }, [
      text('h2', 'What would make me buy'),
      el('div', { html: entry.sections?.what_would_make_me_buy ?? '' }),
    ]), 'main'],
    [el('section', { class: 'panel' }, [text('h2', 'Notes'), el('div', { html: entry.sections?.notes ?? '' })]), 'rail'],
  ];
  if (!hasScan(scan)) items.push([text('p', 'Funding gate status needs a scan run.', { class: 'muted' }), 'full']);
  const chart = visualsOn(config) ? priceChartPanel({ ticker, levels: entry.levels, currency: entry.currency, series }) : null;
  if (chart) items.splice(1, 0, [chart, 'main']);
  splitLayout(container, items);
}
