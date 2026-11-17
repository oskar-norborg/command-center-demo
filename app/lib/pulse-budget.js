// The 3-pulse budget (SPEC.md §5.9, docs/phase3-plan.md §2.5, T3.3b resolved
// 2026-09-21, §8 resolution 1): at most 3 pulsing elements at once, page-wide.
// Priority: the Triggers panel's own AlertCards first, highest severity
// first; any other marker (a grid dot, a watchlist row, a level-bar tick)
// for a name/level *already* pulsing shares that slot, since it is the same
// underlying event shown twice, not a second thing happening; once 3
// distinct events are claimed, every further hit holds its plain static
// colour — never queued or staggered, which would misrepresent "hit right
// now". `near` never appears here at all: it always gets the static amber
// halo (§3), never a pulse.
//
// Pure: callers (command.js, position.js, watchlist.js) collect one
// candidate per `hit` marker actually rendered on the page and pass plain
// descriptors in; this only decides which `key`s pulse. The caller owns
// mapping a `key` back to a DOM node and toggling the `pulsing` class.

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 };
export const MAX_PULSING = 3;

/**
 * @typedef {object} PulseCandidate
 * @property {string} key            unique per marker (e.g. a DOM node's identity string) — what gets returned
 * @property {string} eventKey       identifies the underlying event (e.g. `${ticker}:${levelId}`) — two markers
 *   for the same event share one budget slot
 * @property {'triggers'|'other'} source   `'triggers'` markers (the Triggers panel's own AlertCards) are ranked
 *   first, by severity; everything else only fills remaining slots, or joins an event already claimed
 * @property {'high'|'medium'|'info'} [severity]   only meaningful for `source: 'triggers'`; unknown = lowest
 *
 * @param {PulseCandidate[]} candidates   every `hit` marker on the page — never a `near` one
 * @returns {Set<string>} the candidate `key`s that should carry the `pulsing` class
 */
export function pulseBudget(candidates) {
  const bySeverity = (a, b) => (SEVERITY_ORDER[a.severity] ?? SEVERITY_ORDER.info) - (SEVERITY_ORDER[b.severity] ?? SEVERITY_ORDER.info);
  const claimedEvents = [];
  const pulsingKeys = new Set();

  const admit = (candidate) => {
    if (!claimedEvents.includes(candidate.eventKey)) {
      if (claimedEvents.length >= MAX_PULSING) return;
      claimedEvents.push(candidate.eventKey);
    }
    pulsingKeys.add(candidate.key);
  };

  for (const c of candidates.filter((c) => c.source === 'triggers').sort(bySeverity)) admit(c);
  for (const c of candidates.filter((c) => c.source !== 'triggers')) admit(c);

  return pulsingKeys;
}
