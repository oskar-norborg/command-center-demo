// Scan freshness (SPEC.md §5.2, §10; Phase 2 audit 2026-09-19, finding 3): how old
// is the newest scan, and is it older than it should be? Pure and dependency-free,
// like lib/levels.js and lib/housekeeping.js: the site build copies it to
// dist/lib/ and the browser calls it with the time of the view, so a cron that
// stopped is visible from the page alone, without opening Actions.
//
// "Expected" is the newest close run that should already exist. A close run is
// due on every scan day (a weekday on which at least one of NYSE and Oslo trades,
// the same rule as SPEC §4.1) and is late once it is past `OVERDUE_AFTER_ET`:
// half an hour after the close accept window ends, which covers a slow run.
// Before that time the run of the previous scan day is the newest one
// expected. A morning run is news only and never counts: the newest close (or
// manual) run is what is measured.

import { ACCEPT_WINDOWS } from './schedule.js';

const DAY_MINUTES = 24 * 60;

/** Minutes after the scan day's midnight ET at which its close run is overdue: derived from lib/schedule.js's own
 * `ACCEPT_WINDOWS.close.end`, not a second hardcoded number kept in sync by a comment (the owner, 2026-09-23) — the two
 * cannot drift apart if the window ever changes. With the window ending at 23:59 ET (2026-09-29) it is 1469: 00:29 ET
 * the next day, so it can run past midnight, and everything below reads it that way. */
export const OVERDUE_AFTER_ET = ACCEPT_WINDOWS.close.end.hour * 60 + ACCEPT_WINDOWS.close.end.minute + 30;

const OVERDUE_DAYS_LATER = Math.floor(OVERDUE_AFTER_ET / DAY_MINUTES);
const OVERDUE_MINUTE = OVERDUE_AFTER_ET % DAY_MINUTES;

/** The deadline as the banner says it: `00:29 ET the next day`, or `20:00 ET` for a window ending before 23:30. */
export const OVERDUE_TEXT = `${String(Math.floor(OVERDUE_MINUTE / 60)).padStart(2, '0')}:${String(OVERDUE_MINUTE % 60).padStart(2, '0')} ET${OVERDUE_DAYS_LATER > 0 ? ' the next day' : ''}`;

const ET = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** The ET calendar date and minutes-after-midnight at `nowMs`. */
export function etParts(nowMs) {
  const p = Object.fromEntries(ET.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isHoliday = (holidays, exchange, iso) => (holidays?.[exchange]?.[iso.slice(0, 4)] ?? []).includes(iso);

/** A weekday on which NYSE or Oslo is open (both closed: the close run exits "no session"). */
export function isScanDay(iso, holidays) {
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !(isHoliday(holidays, 'NYSE', iso) && isHoliday(holidays, 'OSE', iso));
}

/**
 * The ET date of the newest close run that should exist at `nowMs`.
 * @param {number} nowMs
 * @param {object|null} [holidays]   parsed data/calendars/holidays.yaml (`state.calendars.holidays`); without it only weekends are skipped
 */
export function expectedScanDate(nowMs, holidays = null) {
  const { date, minutes } = etParts(nowMs);
  // The newest day whose deadline has passed: the deadline of day d falls OVERDUE_DAYS_LATER days after d.
  let d = addDays(date, -(OVERDUE_DAYS_LATER + (minutes >= OVERDUE_MINUTE ? 0 : 1)));
  while (!isScanDay(d, holidays)) d = addDays(d, -1);
  return d;
}

/** `5 min ago`, `3 h ago`, `2 d ago`: whole units, rounded down; never negative. */
export function ageText(ageMs) {
  const min = Math.max(0, Math.floor(ageMs / 60_000));
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}

/**
 * @param {object} args
 * @param {object|null} args.scan   the newest scan (`dist/data/scan.json`)
 * @param {object|null} [args.lastClose]   the newest published close run, used when `scan` is a morning run
 * @param {object|null} [args.holidays]
 * @param {number} args.nowMs
 * @returns {null | {
 *   age: string, ageMs: number|null, overdue: boolean, expected: string, lastDate: string|null,
 *   message: string|null
 * }}   null when there is no scan at all (the page already says "no scan")
 */
export function scanFreshness({ scan, lastClose = null, holidays = null, nowMs }) {
  if (!scan?.run) return null;
  const finished = Date.parse(scan.run.finished_utc ?? '');
  const ageMs = Number.isNaN(finished) ? null : nowMs - finished;
  const basis = scan.run.type === 'morning' ? lastClose : scan;
  const lastDate = /^\d{4}-\d{2}-\d{2}/.test(basis?.run?.id ?? '') ? basis.run.id.slice(0, 10) : null;
  const expected = expectedScanDate(nowMs, holidays);
  const overdue = lastDate === null || lastDate < expected;
  const age = ageMs === null ? 'age unknown' : ageText(ageMs);
  const message = overdue
    ? `Scan overdue: ${lastDate === null ? 'there is no close scan on record' : `the newest close scan is from ${lastDate}`} (${age}); the run for ${expected} was due by ${OVERDUE_TEXT}. Prices, levels and triggers on this page are out of date.`
    : null;
  return { age, ageMs, overdue, expected, lastDate, message };
}
