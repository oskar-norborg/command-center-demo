// Scan page (`#/scan`) — SPEC.md §5.1: the latest briefing, the run log and the
// per-source status of each quote. Read-only: everything shown was recorded by
// the scan (`run`, `quotes[].sources`, `fx`).
import { el, text, clear, scrollWrap } from '../dom.js';
import { hasScan, shortDate } from '../data.js';
import { ccy } from '../../lib/base-currency.js';

function sourceLine(s) {
  if (s.ok) return `${s.name}: ok${typeof s.price === 'number' ? ` ${s.price}` : ''}`;
  return `${s.name}: ${s.error ?? 'failed'}`;
}

export function renderScan(container, { scan }) {
  clear(container);
  container.appendChild(text('h1', 'Scan'));
  if (!hasScan(scan)) {
    container.appendChild(text('p', 'no scan yet — nothing to show.', { class: 'muted' }));
    return;
  }
  const run = scan.run;

  const summary = el('section', { class: 'panel' }, [text('h2', 'Run')]);
  summary.appendChild(text('p', `${run.type} · ${shortDate(run.id.slice(0, 10))} · status ${run.status.toUpperCase()}`));
  summary.appendChild(text('p', `Sessions: ${Object.entries(run.sessions ?? {}).map(([x, s]) => `${x} ${s.date}`).join(' · ')}`, { class: 'muted' }));
  summary.appendChild(text('p', `State commit ${run.state_commit}`, { class: 'muted' }));
  if (run.status_reasons?.length) summary.appendChild(el('ul', { class: 'plain-list' }, run.status_reasons.map((r) => text('li', r, { class: 'amber' }))));
  container.appendChild(summary);

  const briefing = el('section', { class: 'panel' }, [text('h2', 'Briefing')]);
  if (scan.briefing) {
    briefing.appendChild(text('span', scan.briefing.mode, { class: 'chip' }));
    // Written when the scan ran: its figures are that close's, and holdings may have changed since (#97). The command
    // view values them as they are now.
    briefing.appendChild(text('p', `As written at the ${shortDate(String(run.id).slice(0, 10))} close. Holdings and cash may have changed since; the command view shows them as they are now.`, { class: 'muted briefing-as-of' }));
    briefing.appendChild(el('pre', { text: scan.briefing.text }));
  } else {
    briefing.appendChild(text('p', 'no briefing in this scan.', { class: 'muted' }));
  }
  container.appendChild(briefing);

  const fx = el('section', { class: 'panel' }, [text('h2', 'FX')]);
  const usdnok = scan.fx?.USDNOK;
  fx.appendChild(text('p', usdnok ? `USDNOK ${usdnok.rate} · ${usdnok.source} · ${shortDate(usdnok.as_of)} · ${usdnok.label}${usdnok.flags?.length ? ` · ${usdnok.flags.join(', ')}` : ''}` : 'USDNOK unavailable', usdnok ? {} : { class: 'amber' }));
  // A USD book converts nothing, so it has no rate to show.
  if (ccy() === 'NOK') container.appendChild(fx);

  const sources = el('section', { class: 'panel' }, [text('h2', 'Sources per quote')]);
  const table = el('table', { class: 'grid' });
  table.appendChild(el('tr', {}, ['Ticker', 'Label', 'Sources'].map((h) => text('th', h))));
  for (const [ticker, q] of Object.entries(scan.quotes ?? {})) {
    table.appendChild(el('tr', {}, [
      text('td', ticker),
      text('td', `${q.label}${q.flags?.length ? ` (${q.flags.join(', ')})` : ''}`),
      text('td', (q.sources ?? []).map(sourceLine).join(' · ') || '—'),
    ]));
  }
  sources.appendChild(scrollWrap(table));
  container.appendChild(sources);
}
