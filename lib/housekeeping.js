// Housekeeping checks that need only state files, no scan (SPEC.md §4.11 lists
// the scan-time ones). Pure functions so the state build (T1.5), the scan, and
// the site can all call them: the scan at its run, the site in the browser at
// view time when there is no scan (the dated checks below take `today` as an
// argument), so a rule has one implementation. This file is shipped to
// dist/lib/, so it imports only other files shipped beside it (lib/values.js).

import { ISO_DATE, daysBetween, isPositive } from './values.js';

export const NAV_HIGH_DAYS = 30;
export const CASH_STALE_DAYS = 30;
export const DEFAULT_NAV_STALE_DAYS = 14;
export const DEFAULT_STATE_QUIET_DAYS = 30;
/** A dated catalyst (a readout, a decision) is reminded about this many days ahead, and after its date has passed. */
export const CATALYST_SOON_DAYS = 7;
/** A position's `review_by` date is flagged this many days ahead (today included), and in red once it has passed. */
export const REVIEW_SOON_DAYS = 7;

const SEVERITY_RANK = { high: 0, medium: 1, info: 2 };

/** A subject string for ordering items of one kind. */
const subject = (item) => String(item.fund ?? item.account ?? item.ticker ?? item.exchange ?? item.id ?? item.reason ?? '');

/** Items ordered high before medium before info, then by kind and subject; ties keep their order. */
export function sortHousekeeping(items) {
  return [...items].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.kind.localeCompare(b.kind) || subject(a).localeCompare(subject(b)));
}

/** A `## Thesis` section that still holds the migration placeholder. */
export const THESIS_PLACEHOLDER = /^\s*Not recorded\b/i;

/** Text of one `## <heading>` section of a Markdown body (until the next `## `). */
export function sectionText(body, heading) {
  const lines = String(body ?? '').split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * Positions whose thesis text is still the "Not recorded" placeholder
 * (the owner, T1.4 review, answer 5). One housekeeping item per position so the
 * site can list which names still need their three lines.
 * @param {Iterable<[string, {body: string}]>} positions  ticker → loaded file
 * @returns {{kind: 'thesis-needed', ticker: string, severity: 'info'}[]}
 */
export function thesisNeeded(positions) {
  const items = [];
  for (const [ticker, loaded] of positions) {
    const thesis = sectionText(loaded.body, 'Thesis');
    if (thesis === null || thesis === '' || THESIS_PLACEHOLDER.test(thesis)) {
      items.push({ kind: 'thesis-needed', ticker, severity: 'info' });
    }
  }
  return items;
}

/**
 * The Q5 reminder (SPEC.md §10, T2.9's note in §4.11): `rules.min_courtage` pairs of account and market still `null`,
 * as one item because filling them in is one edit to one file. Not the scan's `courtage-unknown`, which needs a
 * buy or add level hit; this one shows for as long as any value is unset, and the 0.5 % courtage check is skipped for
 * those pairs.
 * @param {{rules?: {min_courtage?: Record<string, Record<string, number|null>>}}} portfolio  parsed portfolio.yaml
 * @returns {{kind: 'courtage-unset', pairs: string[], severity: 'info'}[]}
 */
export function courtageUnset(portfolio) {
  const pairs = [];
  for (const [account, markets] of Object.entries(portfolio?.rules?.min_courtage ?? {})) {
    for (const [market, value] of Object.entries(markets ?? {})) {
      if (value == null) pairs.push(`${account}/${market}`);
    }
  }
  return pairs.length > 0 ? [{ kind: 'courtage-unset', pairs, severity: 'info' }] : [];
}

/** The source's own sentence for a minimum courtage nobody has logged yet, kept in the rendered fee rule. */
export const MIN_COURTAGE_UNSET_SENTENCE = 'Min courtage per account: not yet logged here precisely, add once known.';

/**
 * The newest sign that state was touched or checked (§4.11 `state-quiet`): the newest of the trade entries' dates, the NAV
 * `as_of` dates and `confirmed_current_on`. Cash dates are not in the formula; they have their own `cash-stale`.
 * @param {{marks?: object|null, journal?: {date?: string}[]}} args
 * @returns {string|null} an ISO date, or null when nothing is dated
 */
export function latestStateDate({ marks, journal = [] }) {
  const dates = [
    // A hold confirms a decision and an opening entry is a record; neither says holdings, cash or NAVs are current
    // (§3.4a, §3.4b), so neither resets the quiet clock.
    ...journal.filter((j) => j?.action !== 'hold' && j?.action !== 'opening').map((j) => j?.date),
    ...Object.values(marks?.navs ?? {}).map((n) => n?.as_of),
    marks?.confirmed_current_on,
  ].filter((d) => ISO_DATE.test(d ?? ''));
  return dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

/**
 * Reminders for each position's `catalysts` (the owner, 2026-09-21, audit #14: a biotech's Q3 readout had no date and no
 * monitor). One `catalyst-reminder` per catalyst that needs attention: `no-date` (the date is null, info: fill it in),
 * `soon` (within `CATALYST_SOON_DAYS`, today included, medium) or `passed` (the date is behind us, medium: update or
 * remove it). A catalyst further away than that is quiet.
 * @param {object} args
 * @param {string} args.today   ISO date the days are counted from
 * @param {Record<string, {catalysts?: {id: string, name: string, date: string|null}[]}>} [args.positions]   ticker → front matter
 * @returns {object[]}
 */
export function catalystReminders({ today, positions = {} }) {
  const items = [];
  for (const [ticker, position] of Object.entries(positions ?? {})) {
    for (const c of position?.catalysts ?? []) {
      const base = { kind: 'catalyst-reminder', ticker, id: c.id, name: c.name };
      if (!ISO_DATE.test(c.date ?? '')) {
        items.push({ ...base, reason: 'no-date', severity: 'info' });
        continue;
      }
      const days = daysBetween(today, c.date);
      if (days < 0) items.push({ ...base, reason: 'passed', date: c.date, severity: 'medium' });
      else if (days <= CATALYST_SOON_DAYS) items.push({ ...base, reason: 'soon', date: c.date, days_away: days, severity: 'medium' });
    }
  }
  return items;
}

/**
 * The forcing mechanism for position reviews (the owner, 2026-11-09): a position's `review_by: {date, note}` turns into one
 * `review-due` item once it needs attention. `overdue` (the date is before `today`, `high`, with `days_overdue`), `soon`
 * (today up to `REVIEW_SOON_DAYS` days ahead, `medium`, with `days_away`) or, for a `tactical` position with no usable
 * `review_by`, `no-date` (info). A review further off is quiet, and so is a position of any other role with no date.
 * Pure and given `today`, like `catalystReminders`, so the scan and the browser list the same items for the same state.
 * @param {object} args
 * @param {string} args.today   ISO date the days are counted from
 * @param {Record<string, {role?: string, review_by?: {date?: string, note?: string|null}|null}>} [args.positions]   ticker → front matter
 * @returns {object[]}
 */
export function reviewDue({ today, positions = {} }) {
  const items = [];
  for (const [ticker, position] of Object.entries(positions ?? {})) {
    const review = position?.review_by;
    if (!ISO_DATE.test(review?.date ?? '')) {
      if (position?.role === 'tactical') items.push({ kind: 'review-due', ticker, reason: 'no-date', severity: 'info' });
      continue;
    }
    const base = { kind: 'review-due', ticker, date: review.date, note: review.note ?? null };
    const days = daysBetween(today, review.date);
    if (days < 0) items.push({ ...base, reason: 'overdue', days_overdue: -days, severity: 'high' });
    else if (days <= REVIEW_SOON_DAYS) items.push({ ...base, reason: 'soon', days_away: days, severity: 'medium' });
  }
  return items;
}

/**
 * The checks that count days, from state alone: `fund-nav-stale`, `state-quiet`, `cash-stale`,
 * `cash-below-floor`, `catalyst-reminder` and `review-due` (§4.11). The scan calls this with the ET date of the run; the site calls it in the browser with
 * the ET date of the view when there is no scan, so both list the same items for the same state. Boundaries follow the
 * spec's wording: "older than" is strictly more, "high at 30 d" is inclusive.
 * @param {object} args
 * @param {string} args.today   ISO date ages are counted to
 * @param {object|null} args.portfolio   parsed portfolio.yaml (funds, accounts, rules)
 * @param {object|null} args.marks   parsed marks.yaml (navs, cash, confirmed_current_on)
 * @param {{date?: string}[]} [args.journal]   journal front matter, for the latest journal date
 * @param {Record<string, object>} [args.positions]   ticker → position front matter, for `catalysts` and `review_by`
 * @returns {object[]} items in the scan schema's shapes, in check order (see `sortHousekeeping`)
 */
export function ageChecks({ today, portfolio, marks, journal = [], positions = {} }) {
  const rules = portfolio?.rules ?? {};
  const navs = marks?.navs ?? {};
  const items = [];

  // fund-nav-stale
  const staleDays = rules.fund_nav_stale_days ?? DEFAULT_NAV_STALE_DAYS;
  for (const fund of portfolio?.funds ?? []) {
    const nav = navs[fund.id];
    if (!isPositive(nav?.nav)) {
      items.push({ kind: 'fund-nav-stale', fund: fund.id, age_days: null, reason: 'needs-entry', severity: 'medium' });
    } else if (!ISO_DATE.test(nav.as_of ?? '')) {
      items.push({ kind: 'fund-nav-stale', fund: fund.id, age_days: null, reason: 'no-date', severity: 'medium' });
    } else {
      const age = daysBetween(nav.as_of, today);
      if (age > staleDays) {
        items.push({ kind: 'fund-nav-stale', fund: fund.id, age_days: age, reason: 'stale', severity: age >= NAV_HIGH_DAYS ? 'high' : 'medium' });
      }
    }
  }

  // state-quiet
  const last = latestStateDate({ marks, journal });
  if (last !== null) {
    const age = daysBetween(last, today);
    if (age > (rules.state_quiet_warn_days ?? DEFAULT_STATE_QUIET_DAYS)) {
      items.push({ kind: 'state-quiet', last_update: last, age_days: age, severity: 'medium' });
    }
  }

  // cash-stale, cash-below-floor
  for (const [account, entry] of Object.entries(marks?.cash ?? {})) {
    if (ISO_DATE.test(entry?.as_of ?? '')) {
      const age = daysBetween(entry.as_of, today);
      if (age > CASH_STALE_DAYS) items.push({ kind: 'cash-stale', account, as_of: entry.as_of, age_days: age, severity: 'medium' });
    }
  }
  for (const [account, def] of Object.entries(portfolio?.accounts ?? {})) {
    const cash = marks?.cash?.[account]?.nok;
    if (typeof def?.cash_floor === 'number' && typeof cash === 'number' && cash < def.cash_floor) {
      items.push({ kind: 'cash-below-floor', account, cash, floor: def.cash_floor, severity: 'info' });
    }
  }

  // catalyst-reminder
  items.push(...catalystReminders({ today, positions }));

  // review-due
  items.push(...reviewDue({ today, positions }));
  return items;
}
