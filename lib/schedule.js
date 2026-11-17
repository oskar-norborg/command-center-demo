// The scan's ET accept windows (SPEC.md §4.1's cron table). Factored out of lib/calendar.js so
// lib/freshness.js — copied to dist/lib/ and run in the browser (scripts/build-site.js's SHARED_LIB) — can read
// the close window's own end time without pulling in calendar.js's `node:fs`/`luxon` imports, neither of which
// resolves in a browser. This file has no imports of its own, so it is safe to ship both places.
//
// OVERDUE_AFTER_ET (lib/freshness.js) is derived from `close.end` here at module load, not a second hardcoded
// number kept in sync by a comment (the owner, 2026-09-23, after a close run cleared the accept window by only 23
// minutes) — the two cannot drift apart, because there is only one number to change.
//
// The close window's end moved from 19:30 to 23:59 ET on 2026-09-29 (the owner, #67, #81): GitHub started every scheduled
// close 2.5–4 h late and no publish-mode run had landed before 19:30. Correctness comes from the quote labels (a
// confirmed close needs a timestamp at or after the session's close), not from the start time; the 16:30 start is what
// keeps a run from judging a session that has not closed. 23:59 is the last minute of the run's ET day, the day that
// names its file and lock, and 05:59 in Oslo, hours before the next Oslo session opens (SPEC.md §4.1).
export const ACCEPT_WINDOWS = {
  close: { start: { hour: 16, minute: 30 }, end: { hour: 23, minute: 59 } },
  morning: { start: { hour: 8, minute: 0 }, end: { hour: 10, minute: 0 } },
};
