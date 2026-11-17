// Offline "cached <time>" banner (SPEC.md §7.1/phase 3.5, docs/phase3-plan.md
// §5 T3.5b). Reuses the .stale-banner shape (scan-age.js) but in --cyan, not
// --amber/--red: "offline, showing what I last saw" is a calmer message than
// "the scan is late" or "the quote failed" and must not be mistaken for
// either (§3's colour+texture rule).
import { el, text } from '../dom.js';

const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A cyan banner naming when the offline data now on screen was cached, or nothing when `cachedAt` is null. */
export function cachedBanner(cachedAt) {
  if (!cachedAt) return null;
  const when = Number.isNaN(Date.parse(cachedAt)) ? null : `${ET_TIME.format(new Date(cachedAt))} ET`;
  return el('div', { class: 'cache-banner', attrs: { role: 'status' } }, [
    text('strong', 'OFFLINE. '),
    text('span', when ? `Showing what was last cached, ${when}.` : 'Showing what was last cached.'),
  ]);
}
