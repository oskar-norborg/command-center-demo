// A quote as text (SPEC.md §5.3, §5.4, Appendix B): the price with its label
// glyph, or "—" with the reason and the last good price and its date. Never a
// price with a `fetch failed` label, never a number when two sources disagreed.
import { el, text } from '../dom.js';
import { LABEL_GLYPH, changeBasisText, priceText, shortDate } from '../data.js';

const money = (n) => (typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');

/** The reason and last good price shown under a `—` (also used in the dossier header). */
export function unavailableNote(view) {
  const parts = [];
  if (view.reason) parts.push(view.reason);
  if (view.last_good) parts.push(`last good ${money(view.last_good.price)}${view.last_good.as_of ? ` (${shortDate(view.last_good.as_of)})` : ''}`);
  return parts.join(' · ');
}

/** A grid cell's content for one quote view. */
export function priceCell(view) {
  if (view.kind === 'price' || view.kind === 'range') {
    const glyph = view.label ? LABEL_GLYPH[view.label] : '';
    const cell = el('span', { class: 'price-cell', attrs: view.label ? { title: view.label } : {} }, [
      glyph ? text('span', glyph, { class: 'glyph', attrs: { 'aria-label': view.label } }) : null,
      text('span', priceText(view)),
    ]);
    if (view.kind === 'range') cell.appendChild(text('small', ' sources disagree', { class: 'muted' }));
    return cell;
  }
  const cell = el('span', { class: 'price-cell price-none' }, [text('span', '—')]);
  if (view.kind === 'unavailable') {
    const note = unavailableNote(view);
    if (note) cell.appendChild(text('small', ` ${note}`, { class: 'muted' }));
    if (view.label) cell.setAttribute('title', view.label);
  }
  return cell;
}

/** `confirmed close · 17 Sep`, the label text under a dossier's price. */
export function labelLine(view) {
  if (view.kind !== 'price' && view.kind !== 'range') return '';
  const when = view.session_date ? ` · ${shortDate(view.session_date)}` : '';
  return `${view.label ?? ''}${view.label ? when : ''}`.trim();
}

/** A day-change line with what it is measured against, or ''. `note` (a price that is not the session's close,
 * brief.js `priceNote`) puts ≈ on it and says what the price is. */
function changeLine(view, note = null) {
  if (view.kind !== 'price' || view.change_pct == null) return '';
  const pct = `${note ? '≈' : ''}${view.change_pct > 0 ? '+' : ''}${view.change_pct}%`;
  return `${pct} ${changeBasisText(view.change_basis)}${note ? ` (${note}, not this close)` : ''}`.trim();
}

/**
 * The dossier header's price area (SPEC.md §5.4, Appendix B): the price with its label and session date and the
 * day change with its basis; a range when sources disagreed; "—" with the reason and the last good price and its
 * date when there is no price; and on an Oslo name the reference-price footnote. Returns DOM nodes.
 */
export function priceBlock(view, ticker, note = null) {
  const nodes = [];
  if (view.kind === 'price' || view.kind === 'range') {
    nodes.push(text('p', priceText(view), { class: 'price' }));
    const label = labelLine(view);
    nodes.push(text('p', view.kind === 'range' ? `sources disagree${label ? ` · ${label}` : ''}` : label, { class: 'muted' }));
    const change = changeLine(view, note);
    if (change) nodes.push(text('p', change));
  } else if (view.kind === 'unavailable') {
    nodes.push(text('p', '—', { class: 'price' }));
    nodes.push(text('p', unavailableNote(view), { class: 'muted' }));
  } else {
    nodes.push(text('p', 'no scan — price unavailable', { class: 'muted' }));
  }
  const showsPrice = view.kind === 'price' || view.kind === 'range' || (view.kind === 'unavailable' && view.last_good);
  if (/\.OL$/i.test(ticker) && showsPrice) nodes.push(text('p', 'reference price, verify on Nordnet before any order', { class: 'muted footnote' }));
  return nodes;
}
