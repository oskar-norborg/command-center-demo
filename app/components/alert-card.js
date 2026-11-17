// One alert (SPEC.md §5.3, Appendix B). The wording is the level-hit framing,
// "condition to check", never a bare instruction; the action is shown as an
// action to consider. The card links to the dossier only when there is one: a
// position, or a watchlist name; a book-level alert (cap, tech) links nowhere.
import { el, text } from '../dom.js';
import { shortDate } from '../data.js';

const KIND_FRAME = { hit: 'Level hit', near: 'Level near' };

function dossierHref(alert, state) {
  const t = encodeURIComponent(alert.ticker);
  if (state?.positions?.[alert.ticker]) return `#/p/${t}`;
  if (state?.watchlist?.[alert.ticker]) return `#/w/${t}`;
  return null;
}

/**
 * @param {object} alert   an `alerts[]` entry of the scan output
 * @param {{state?: object}} [context]   the state, to tell where the alert's ticker has a dossier
 */
export function alertCard(alert, { state } = {}) {
  const levelClass = alert.level_type ? ` level-${alert.level_type}` : '';
  const card = el('div', { class: `alert-card sev-${alert.severity}${levelClass}` });
  card.appendChild(text('div', alert.title, { class: 'alert-title' }));

  const chips = el('div', { class: 'alert-chips' });
  if (alert.level_type) chips.appendChild(text('span', alert.level_type, { class: `chip chip-type level-${alert.level_type}` }));
  chips.appendChild(text('span', alert.kind, { class: 'chip' }));
  if (alert.decision_needed) chips.appendChild(text('span', 'decision needed', { class: 'chip chip-amber' }));
  if (alert.informational) chips.appendChild(text('span', 'informational', { class: 'chip', attrs: alert.funding_note ? { title: alert.funding_note } : {} }));
  // The scan judged the price only; the level's condition is the owner's to check (audit #6).
  if (alert.conditional) chips.appendChild(text('span', 'conditional', { class: 'chip chip-amber' }));
  card.appendChild(chips);

  // A price never stands bare: its label and session date sit right under the title (audit 2026-09-19, #1).
  if (alert.price_label) {
    const when = alert.price_date ? ` · ${shortDate(alert.price_date)}` : '';
    card.appendChild(text('div', `Price: ${alert.price_label}${when}`, { class: 'alert-price muted' }));
  }
  // Overnight fixes item 3: the condition/action/decision text is the bulk of a card's height and is already
  // repeated, word for word, on the ticker's own dossier — collapsed by default on the command view, full text one
  // tap away, native <details> (same disclosure the Briefing panel already uses, so no new interaction pattern).
  const detailNodes = [];
  if (alert.condition) {
    const frame = KIND_FRAME[alert.kind];
    detailNodes.push(text('div', frame ? `${frame} — condition to check: ${alert.condition}` : `Rule: ${alert.condition}`, { class: 'alert-condition' }));
  }
  if (alert.action) detailNodes.push(text('div', `Action to consider: ${alert.action}`, { class: 'alert-action' }));
  if (alert.decision_needed) detailNodes.push(text('div', alert.decision_needed, { class: 'alert-decision' }));
  if (detailNodes.length) {
    card.appendChild(el('details', { class: 'alert-detail' }, [
      el('summary', {}, [text('span', 'Condition & action')]),
      ...detailNodes,
    ]));
  }

  const href = dossierHref(alert, state);
  card.appendChild(href ? el('a', { attrs: { href }, text: alert.ticker }) : text('span', alert.ticker, { class: 'muted' }));
  return card;
}
