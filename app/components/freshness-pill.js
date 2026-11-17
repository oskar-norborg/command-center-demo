// The state-freshness pill (SPEC.md §5.2): how long since state was touched or
// checked, amber once it is over the quiet limit. Uses the same three dates as
// the `state-quiet` housekeeping check (§4.11): the newest journal entry, the
// newest NAV date and `confirmed_current_on`.
import { text } from '../dom.js';
import { daysSince } from '../data.js';
import { latestStateDate } from '../../lib/housekeeping.js';

/** Days since state was last touched or checked, or null if nothing is dated. */
export function stateAgeDays(state, nowMs) {
  const last = latestStateDate({ marks: state?.marks, journal: Object.values(state?.journal ?? {}) });
  return last === null ? null : daysSince(last, nowMs);
}

export function freshnessPill(state, nowMs) {
  const age = stateAgeDays(state, nowMs);
  if (age === null) return text('span', 'state ?', { class: 'pill pill-state muted' });
  // A state date after today is an error in the files (or a wrong clock), never a fresh state: amber, and said in
  // words, not a silent negative number (the owner, 2026-10-01).
  if (age < 0) {
    return text('span', `state dated ${-age} d ahead`, { class: 'pill pill-state amber', attrs: { title: 'A state date is after today: check the newest journal, NAV or confirmed_current_on date.' } });
  }
  const limit = state?.portfolio?.rules?.state_quiet_warn_days ?? 30;
  return text('span', `state ${age} d`, { class: `pill pill-state${age > limit ? ' amber' : ' muted'}` });
}
