// Hash router — SPEC.md §5.1. Plain pattern matching, no dependency.
const ROUTE_DEFS = [
  { name: 'command', pattern: /^#\/$/ },
  // The bottom nav's Positions tab: the command view opened at its holdings (2026-09-23), so the two tabs are two places.
  { name: 'positions', pattern: /^#\/positions$/ },
  { name: 'position', pattern: /^#\/p\/([^/]+)$/, params: ['ticker'] },
  { name: 'watchlist-dossier', pattern: /^#\/w\/([^/]+)$/, params: ['ticker'] },
  { name: 'watchlist', pattern: /^#\/watchlist$/ },
  { name: 'journal-detail', pattern: /^#\/journal\/([^/]+)$/, params: ['id'] },
  { name: 'journal', pattern: /^#\/journal$/ },
  { name: 'scan', pattern: /^#\/scan$/ },
  { name: 'state', pattern: /^#\/state$/ },
  { name: 'settings', pattern: /^#\/settings$/ },
];

/** hash string ("#/p/ABC.OL") -> { name, params }. Unknown hash -> { name: 'not-found', params: {} }. */
export function parseRoute(hash) {
  const h = hash && hash !== '#' ? hash : '#/';
  for (const def of ROUTE_DEFS) {
    const match = h.match(def.pattern);
    if (!match) continue;
    const params = {};
    (def.params ?? []).forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { name: def.name, params };
  }
  return { name: 'not-found', params: { hash: h } };
}

export function currentRoute() {
  return parseRoute(window.location.hash);
}

export function onRouteChange(handler) {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
