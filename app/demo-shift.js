// The demo keeps itself current (SPEC.md §5.11, 2026-11-16). A demo build is dated to the latest close before the
// build (scripts/demo-dates.js). If nobody rebuilds it, this module moves every date in the loaded data forward when
// the page is opened, by the same rule the build uses, so a demo deployed once never opens on SCAN OVERDUE.
//
// Loaded only when the build is a demo (main.js imports it on `config.demo`); the real site never runs it, and
// nothing here can touch real data: it rewrites the invented JSON the page has already fetched, in memory.
//
// The rule, as in the build: `latest` is today (New York time) once the close window has opened on a day both
// exchanges trade, else the last such day before. A date k weekdays from the build's own latest session becomes
// the day k sessions from the page's latest session. data/demo-clock.json carries the build's latest session and
// the weekdays on which the exchanges are closed, so no calendar logic is duplicated here.
//
// What moves: ISO dates and timestamps anywhere in the data (values and keys, so a journal entry's id and the link
// to it move together), and the short dates the scan wrote into its text ("16 Nov"). A UTC timestamp keeps its New
// York time of day, so a close stamped 16:41 there still reads 16:41 after a clock change. Imports nothing.

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekdayOf = (ms) => new Date(ms).getUTCDay();   // 0 Sunday … 6 Saturday
const isWeekday = (ms) => weekdayOf(ms) !== 0 && weekdayOf(ms) !== 6;

/** The New York date, hour and minute at `now` (a Date). */
export function newYorkNow(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/**
 * The date mapping for a page opened at `now`, or null when nothing needs to move.
 * @param {{latest: string, closed: string[]}} clock   data/demo-clock.json
 * @param {Date} now
 * @returns {null | {latest: string, mapDate: (iso: string) => string}}
 */
export function demoShift(clock, now) {
  if (!clock || typeof clock.latest !== 'string' || !Array.isArray(clock.closed)) return null;
  const closed = new Set(clock.closed);
  const isSession = (ms) => isWeekday(ms) && !closed.has(toIso(ms));
  const step = (fromMs, k) => {
    let ms = fromMs;
    const dir = k < 0 ? -1 : 1;
    for (let left = Math.abs(k); left > 0;) {
      ms += dir * DAY_MS;
      if (isSession(ms)) left -= 1;
    }
    return ms;
  };
  const ny = newYorkNow(now);
  let latestMs = toMs(ny.date);
  const windowOpen = ny.hour > 16 || (ny.hour === 16 && ny.minute >= 30);
  if (!(isSession(latestMs) && windowOpen)) {
    latestMs -= DAY_MS;
    while (!isSession(latestMs)) latestMs -= DAY_MS;
  }
  const latest = toIso(latestMs);
  if (latest <= clock.latest) return null;

  const snap = (ms) => (weekdayOf(ms) === 6 ? ms - DAY_MS : weekdayOf(ms) === 0 ? ms - 2 * DAY_MS : ms);
  const builtMs = snap(toMs(clock.latest));
  const weekdaysFromBuilt = (iso) => {
    const target = snap(toMs(iso));
    if (target === builtMs) return 0;
    const dir = target > builtMs ? 1 : -1;
    let n = 0;
    for (let ms = builtMs; ms !== target;) {
      ms += dir * DAY_MS;
      if (isWeekday(ms)) n += dir;
    }
    return n;
  };
  const cache = new Map();
  const mapDate = (iso) => {
    if (!cache.has(iso)) cache.set(iso, toIso(step(latestMs, weekdaysFromBuilt(iso))));
    return cache.get(iso);
  };
  return { latest, mapDate };
}

const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?/g;
const SHORT_DATE = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')})\\b`, 'g');

/** New York's offset from UTC at `ms`, in minutes (−240 in summer, −300 in winter). */
function newYorkOffset(ms) {
  const ny = newYorkNow(new Date(ms));
  const asUtc = Date.UTC(Number(ny.date.slice(0, 4)), Number(ny.date.slice(5, 7)) - 1, Number(ny.date.slice(8, 10)), ny.hour, ny.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/**
 * A UTC timestamp moved to its new date at the same New York time of day: a close stamped 16:41 in New York stays
 * 16:41 there when the move crosses a clock change. The text keeps its own precision (seconds, milliseconds).
 */
function moveStamp(d, time, mapDate) {
  const from = Date.parse(`${d}${time}`);
  const plain = Date.parse(`${mapDate(d)}${time}`);
  if (Number.isNaN(from) || Number.isNaN(plain)) return `${mapDate(d)}${time}`;
  const to = new Date(plain + (newYorkOffset(from) - newYorkOffset(plain)) * 60000).toISOString();
  const digits = /\.(\d+)Z$/.exec(time)?.[1].length ?? 0;
  const hasSeconds = /T\d{2}:\d{2}:\d{2}/.test(time);
  if (digits) return `${to.slice(0, 20)}${to.slice(20, 23).padEnd(digits, '0').slice(0, digits)}Z`;
  return hasSeconds ? `${to.slice(0, 19)}Z` : `${to.slice(0, 16)}Z`;
}

/** Move the dates inside one string: ISO dates and timestamps, and short dates like "16 Nov" (read near `nearIso`). */
export function shiftText(value, mapDate, nearIso) {
  let out = value.replace(ISO_DATE, (_, d, time = '') => (time.endsWith('Z') ? moveStamp(d, time, mapDate) : `${mapDate(d)}${time}`));
  if (nearIso) {
    const near = toMs(nearIso);
    out = out.replace(SHORT_DATE, (whole, day, mon) => {
      const m = MONTHS.indexOf(mon);
      // The year that puts this day closest to the build's latest session: demo text never reaches far from it.
      const year = [-1, 0, 1].map((dy) => Number(nearIso.slice(0, 4)) + dy)
        .sort((a, b) => Math.abs(Date.UTC(a, m, Number(day)) - near) - Math.abs(Date.UTC(b, m, Number(day)) - near))[0];
      const iso = toIso(Date.UTC(year, m, Number(day)));
      if (Number(iso.slice(8, 10)) !== Number(day)) return whole;   // not a real day of that month
      const moved = mapDate(iso);
      return `${Number(moved.slice(8, 10))} ${MONTHS[Number(moved.slice(5, 7)) - 1]}`;
    });
  }
  return out;
}

/** A deep copy of `value` with every string and every object key passed through `fn`. */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), mapStrings(v, fn)]));
  return value;
}

/**
 * The loaded data with its dates moved to the page's own day, or the same object when nothing needs to move.
 * `config` is left alone. Short dates in text are only rewritten in what a scan wrote (scan, last close, previous
 * close), where they are the scan's own formatting; state prose is the demo author's and carries ISO dates only.
 */
export function shiftDemoData(data, clock, now = new Date()) {
  const shift = demoShift(clock, now);
  if (!shift) return data;
  const iso = (s) => shiftText(s, shift.mapDate, null);
  const scanText = (s) => shiftText(s, shift.mapDate, clock.latest);
  const out = { ...data };
  for (const key of ['state', 'findings', 'history', 'outcomes', 'series']) if (data[key] != null) out[key] = mapStrings(data[key], iso);
  for (const key of ['scan', 'lastClose', 'prevClose']) if (data[key] != null) out[key] = mapStrings(data[key], scanText);
  out.demoShiftedTo = shift.latest;
  return out;
}

/** Fetch the demo clock and shift `data`. Any failure leaves the data as built: an old date beats a broken page. */
export async function keepDemoCurrent(data, now = new Date()) {
  try {
    const res = await fetch('data/demo-clock.json', { cache: 'no-cache' });
    if (!res.ok) return data;
    return shiftDemoData(data, await res.json(), now);
  } catch {
    return data;
  }
}
