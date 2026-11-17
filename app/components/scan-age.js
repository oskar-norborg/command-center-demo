// The scan's age in the top bar, and a banner when it is older than expected
// (SPEC.md §5.2, §10; Phase 2 audit 2026-09-19, finding 3). The rule is
// lib/freshness.js; this file only shows its answer. Nothing here fetches.
import { el, text } from '../dom.js';
import { scanFreshness } from '../../lib/freshness.js';

/** The freshness of the page's newest scan at `nowMs`, from what `loadData` returned (null with no scan). */
export function freshnessOf(data, nowMs) {
  return scanFreshness({ scan: data?.scan, lastClose: data?.lastClose, holidays: data?.state?.calendars?.holidays ?? null, nowMs });
}

/** A red `SCAN OVERDUE` pill when the newest close scan is older than expected, else nothing. */
export function overduePill(freshness) {
  return freshness?.overdue ? text('span', 'SCAN OVERDUE', { class: 'status-pill status-failed scan-overdue' }) : null;
}

/** A banner, on every page, saying the scan is overdue and that what follows is old; nothing when it is not. */
export function staleBanner(freshness) {
  if (!freshness?.overdue) return null;
  return el('div', { class: 'stale-banner', attrs: { role: 'alert' } }, [text('strong', 'SCAN OVERDUE. '), text('span', freshness.message)]);
}
