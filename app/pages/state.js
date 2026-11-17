// Read-only "sleeve-state" view (`#/state`) — SPEC.md §3.7 / §5.1. Same
// sections as scripts/render-state.js's Markdown document, built here from
// the same state.json instead of re-reading data/.
import { el, text, clear, row, scrollWrap } from '../dom.js';

import { acct as acctName, ccy } from '../../lib/base-currency.js';
import { money } from '../data.js';

// The same sentence as lib/housekeeping.js's MIN_COURTAGE_UNSET_SENTENCE (tests/housekeeping.test.js keeps them equal).
const MIN_COURTAGE_UNSET_SENTENCE = 'Min courtage per account: not yet logged here precisely, add once known.';

function navText(nav) {
  if (!nav) return '—';
  if (nav.status === 'needs-entry') return 'needs entry';
  return `${money(nav.nav)} (as of ${nav.as_of})`;
}

/** A GAV is never shown without the date it was read from Nordnet (audit #18), as on the position dossier. */
function gavText(gav, asOf) {
  return `${gav} (${asOf ? `as of ${asOf}` : 'date not recorded'})`;
}

function fundRow(fund, navs) {
  const units = Object.entries(fund.units ?? {})
    .map(([a, u]) => `${acctName(a)} ${u}`)
    .join(' + ');
  const gav = Object.entries(fund.gav ?? {})
    .map(([a, g]) => `${acctName(a)} ${money(g)}`)
    .join(' + ');
  return el('tr', {}, [
    text('td', fund.name),
    text('td', units),
    text('td', gav ? gavText(gav, fund.gav_as_of) : '—'),
    text('td', navText(navs?.[fund.id])),
    text('td', (fund.rules ?? []).join(' ')),
  ]);
}

function positionRow(position) {
  return el('tr', {}, [
    text('td', position.name),
    text('td', acctName(position.account)),
    text('td', String(position.units)),
    text('td', gavText(money(position.gav), position.gav_as_of)),
    text('td', position.tax_note ?? '—'),
  ]);
}

function table(headers, rows) {
  const t = el('table', { class: 'grid' });
  t.appendChild(el('tr', {}, headers.map((h) => text('th', h))));
  if (!rows.length) {
    t.appendChild(el('tr', {}, [text('td', '(none)', { attrs: { colspan: String(headers.length) } })]));
  } else {
    for (const r of rows) t.appendChild(r);
  }
  return scrollWrap(t);
}

function section(title, children = []) {
  return el('section', { class: 'panel' }, [text('h2', title), ...children]);
}

export function renderState(container, { state }) {
  clear(container);
  container.appendChild(text('h1', 'Sleeve state (read-only)'));

  if (!state?.portfolio) {
    container.appendChild(text('p', 'no state files yet.', { class: 'muted' }));
    return;
  }
  const { portfolio, marks, positions, watchlist } = state;

  container.appendChild(text('p', `Generated ${state.generated_at} at commit ${state.state_commit}.`, { class: 'muted' }));

  const cash = section('Cash');
  for (const [acct, c] of Object.entries(marks?.cash ?? {})) {
    const floor = portfolio.accounts?.[acct]?.cash_floor;
    cash.appendChild(
      row(acctName(acct), `${money(c.nok)} ${ccy()} (as of ${c.as_of})${floor ? `, floor ${money(floor)} ${ccy()}` : ''}`)
    );
  }
  container.appendChild(cash);

  const core = section('Core (no rotation)', [
    table(['Fund', 'Units', 'GAV', 'NAV (as of)', 'Rules'], (portfolio.funds ?? []).map((f) => fundRow(f, marks?.navs))),
    table(
      ['Position', 'Account', 'Units', 'GAV', 'Tax note'],
      Object.values(positions ?? {})
        .filter((p) => p.role === 'core' || p.role === 'core-active')
        .map(positionRow)
    ),
  ]);
  container.appendChild(core);

  // The sleeve panel lists the `nordic-active` positions. With none held (the demo, or the real book once its Nordic
  // names are sold) there is nothing to list, so the panel is left out instead of showing an empty table.
  const sleeve = portfolio.sleeve ?? {};
  const sleevePositions = Object.values(positions ?? {}).filter((p) => p.role === 'nordic-active');
  if (sleevePositions.length) {
    container.appendChild(section(sleeve.name ?? 'Active sleeve', [
      text('p', `Inception ${sleeve.inception}, value ${money(sleeve.inception_value_nok)} ${ccy()}.`),
      table(['Position', 'Account', 'Units', 'GAV', 'Tax note'], sleevePositions.map(positionRow)),
    ]));
  }

  const tactical = Object.values(positions ?? {}).filter((p) => p.role === 'tactical');
  if (tactical.length) {
    container.appendChild(section('Tactical trades', [
      table(['Position', 'Account', 'Units', 'GAV', 'Tax note'], tactical.map(positionRow)),
    ]));
  }

  const watch = section(
    'Watchlist (not held)',
    [
      table(
        ['Ticker', 'Name', 'Priority', 'Target'],
        Object.entries(watchlist ?? {})
          .sort((a, b) => (a[1].priority ?? Infinity) - (b[1].priority ?? Infinity))
          .map(([ticker, w]) =>
            el('tr', {}, [text('td', ticker), text('td', w.name), text('td', w.priority ?? '—'), text('td', acctName(w.target_account))])
          )
      ),
    ]
  );
  container.appendChild(watch);

  const pipeline = portfolio.position2_pipeline ?? {};
  container.appendChild(
    section('Position #2 pipeline', [
      text('p', pipeline.rule ?? ''),
      text('p', `Status: ${pipeline.status}${pipeline.status_reason ? ` — ${pipeline.status_reason}` : ''}`),
      text('p', `Bench: ${(pipeline.bench ?? []).join(', ') || '(none)'}`),
    ])
  );

  container.appendChild(
    section(
      'Exited',
      [
        el(
          'ul',
          { class: 'plain-list' },
          (portfolio.exited ?? []).map((i) => text('li', `${i.ticker}: ${i.note}`))
        ),
      ]
    )
  );
  container.appendChild(
    section(
      'Rejected',
      [
        el(
          'ul',
          { class: 'plain-list' },
          (portfolio.rejected ?? []).map((i) => text('li', `${i.ticker}: ${i.note}`))
        ),
      ]
    )
  );

  const rules = portfolio.rules ?? {};
  // The source's sentence about the minimum courtage stays in the rule for as long as any value is unset (audit #16).
  const unsetCourtage = (state.housekeeping ?? []).some((h) => h.kind === 'courtage-unset');
  container.appendChild(
    section('Fees', [
      text(
        'p',
        `Fee floor per buy: ${money(rules.fee_floor_per_buy_nok)} ${ccy()}. ${unsetCourtage ? `${MIN_COURTAGE_UNSET_SENTENCE} ` : ''}Courtage warn: ${rules.courtage_warn_pct}% of order value.`
      ),
    ])
  );
  container.appendChild(section('Account rules', [text('p', (rules.account_rules ?? '').trim())]));
}
