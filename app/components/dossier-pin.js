// The pinned dossier row on a phone (#59, SPEC.md §5.4): once the full dossier header has scrolled away, one line
// keeps the ticker, the price with its label glyph (never a bare number), the label text and the day change in view. The full header
// stays in normal flow at the top with the name, account chip and Nordnet reference line, which scroll away with it.
// The row repeats what the header already says, so it is aria-hidden: a screen reader reads the header once.
import { el, text } from '../dom.js';
import { labelLine, priceCell } from './quote-price.js';
import { LABEL_GLYPH } from '../data.js';

/** The day change as the pinned row shows it: `-1.99%`, with ≈ when the price is not the session's close; or null. */
export function pinChangeText(view, note = null) {
  if (view.kind !== 'price' || view.change_pct == null) return null;
  return `${note ? '≈' : ''}${view.change_pct > 0 ? '+' : ''}${view.change_pct}%`;
}

/** The row itself, hidden until `watchHeader` shows it. `note` is brief.js `priceNote` (null for a confirmed close). */
export function dossierPin(ticker, view, note = null) {
  const change = pinChangeText(view, note);
  // The label line carries the session date, so a note like `intraday print, 29 Sep` would only repeat it; the ≈ on
  // the change says the price is not this close. A failed quote gets its ✕ in front of the "—", as a glyph never goes missing.
  const label = labelLine(view);
  const price = priceCell(view);
  if (view.kind === 'unavailable') price.insertBefore(text('span', LABEL_GLYPH['fetch failed'], { class: 'glyph' }), price.firstChild);
  const row = el('div', { class: 'dossier-pin', attrs: { 'aria-hidden': 'true' } }, [
    text('span', ticker, { class: 'pin-ticker' }),
    price,
    change ? text('span', change, { class: 'pin-change' }) : null,
    label ? text('span', label, { class: 'pin-label muted' }) : null,
  ]);
  row.hidden = true;
  return row;
}

/**
 * Shows `pin` while `header` is entirely above the viewport, hides it otherwise. Without IntersectionObserver the row
 * simply stays hidden and the header scrolls away with the page. The observer disconnects once the page is re-rendered.
 */
export function watchHeader(header, pin) {
  if (typeof IntersectionObserver !== 'function') return null;
  const observer = new IntersectionObserver(([entry]) => {
    if (!header.isConnected) {
      observer.disconnect();
      return;
    }
    pin.hidden = entry.isIntersecting || entry.boundingClientRect.top >= 0;
  });
  observer.observe(header);
  return observer;
}
