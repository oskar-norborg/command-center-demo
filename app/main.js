// Composition root — SPEC.md §5.1/§5.2. Loads data once, then renders the
// route into #app on every load and hash change. Plain and correct, not
// styled (T1.6): no boot sequence, no HUD, no animation (those are later
// tasks per SPEC.md §5.8/§5.9).
import { onRouteChange, currentRoute } from './router.js';
import { loadData, hasScan } from './data.js';
import { setAccounts } from '../lib/base-currency.js';
import { withLiveState } from './live-state.js';
import { el, text, clear } from './dom.js';
import { renderCommand, scanStatusLabel } from './pages/command.js';
import { renderScan } from './pages/scan.js';
import { freshnessPill } from './components/freshness-pill.js';
import { freshnessOf, overduePill, staleBanner } from './components/scan-age.js';
import { shortDate } from './data.js';
import { renderPosition } from './pages/position.js';
import { renderWatchlist, renderWatchlistDossier } from './pages/watchlist.js';
import { renderState } from './pages/state.js';
import { JOURNAL_PLACEHOLDER, renderJournal, renderJournalEntry } from './pages/journal.js';
import { renderSettings, applyMotionClass, voiceEnabled } from './pages/settings.js';
import { shouldBoot, runBoot } from './components/boot.js';
import { cachedBanner } from './components/cache-banner.js';
import { brandMark } from './components/brand-mark.js';
import { micButton, voiceSupported } from './components/mic.js';

const app = document.getElementById('app');
const chrome = document.getElementById('chrome');
const bottomNav = document.getElementById('bottom-nav');

// Bottom nav (phone only, hidden above 900px by CSS — SPEC.md §5.2, docs/phase3-plan.md §4.1). "Positions" opens the
// command view at its holdings (`#/positions`, 2026-09-23): it used to point at `#/` like "Command", so both tabs lit
// up at once. Mic (SPEC.md §5.10) is the 5th slot when the browser has a speech recognizer.
const BOTTOM_NAV_ITEMS = [
  { label: 'Command', href: '#/' },
  { label: 'Positions', href: '#/positions' },
  { label: 'Watch', href: '#/watchlist' },
  // Journal was left out from the layout pass (2026-09-22) until T4.1 built the page; back since T4.1's second half.
  { label: 'Journal', href: '#/journal' },
];

/**
 * A new route opens at its top (the owner's phone test, 2026-09-30): a hash change keeps the document's scroll position, so
 * a dossier tapped 2000px down the command view opened 2000px down the dossier, at its last panels. Runs before the
 * route renders, so a route that places itself (`#/positions` scrolls to its holdings) still does. The scrolling element's
 * scrollTop, not window.scrollTo: same effect in a browser, and jsdom implements it.
 */
export function scrollToTop() {
  const scroller = document.scrollingElement ?? document.documentElement;
  if (scroller) scroller.scrollTop = 0;
}

export function renderBottomNav(data) {
  if (!bottomNav) return;
  clear(bottomNav);
  const hash = window.location.hash && window.location.hash !== '#' ? window.location.hash : '#/';
  for (const item of BOTTOM_NAV_ITEMS) {
    bottomNav.appendChild(el('a', {
      class: `bottom-nav-item${hash === item.href ? ' active' : ''}`,
      attrs: { href: item.href, ...(hash === item.href ? { 'aria-current': 'page' } : {}) },
      text: item.label,
    }));
  }
  // Mic (SPEC.md §5.10, T3.6): the bottom nav's 5th slot, real now — still entirely absent, not disabled, when the
  // browser has no speech recognizer (mic.js's own gate) or settings turned it off.
  if (data && voiceEnabled()) {
    const mic = micButton({ names: voiceNames(data.state), onCommand: (command) => handleVoiceCommand(data, command) });
    if (mic) {
      mic.classList.add('bottom-nav-mic');
      bottomNav.appendChild(mic);
    }
  }
}

/** Every position/watchlist entry a "show me"/"open" voice command may resolve to (site/app/lib/voice-grammar.js). */
function voiceNames(state) {
  return [
    ...Object.entries(state?.positions ?? {}).map(([ticker, p]) => ({ ticker, name: p.name })),
    ...Object.entries(state?.watchlist ?? {}).map(([ticker, w]) => ({ ticker, name: w.name })),
  ];
}

// Set by a "what's near a sell/buy level" voice command, consumed by the very next command-view render
// (renderRoute below) and cleared immediately after — a transient view, never a route, never persisted (SPEC.md §5.10).
let pendingTriggerFilter = null;

function handleVoiceCommand(data, command) {
  if (command.type === 'dossier') {
    location.hash = `#/p/${encodeURIComponent(command.ticker)}`;
  } else if (command.type === 'route') {
    location.hash = command.name === 'home' ? '#/' : `#/${command.name}`;
  } else if (command.type === 'filter') {
    pendingTriggerFilter = command.want;
    if (['command', 'positions'].includes(currentRoute().name)) renderRoute(data, currentRoute());
    else location.hash = '#/';
  }
}

const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** `Close · 17 Sep · 16:34 ET · 2 h ago`; a morning run says it is news only (SPEC.md §5.2, T2.13). `age` is lib/freshness.js's text. */
export function lastScanText(scan, age = null) {
  if (!hasScan(scan)) return 'no scan';
  const { type, id, finished_utc: finished } = scan.run;
  const kind = `${type[0].toUpperCase()}${type.slice(1)}${type === 'morning' ? ' · news only' : ''}`;
  const time = finished && !Number.isNaN(Date.parse(finished)) ? ` · ${ET_TIME.format(new Date(finished))} ET` : '';
  return `${kind} · ${shortDate(id.slice(0, 10))}${time}${age ? ` · ${age}` : ''}`;
}

/**
 * The last run's status pill and, while the scan is overdue, the SCAN OVERDUE pill (#95). Overdue, the warning comes
 * first and the status pill is worded as that run's own result (`LAST RUN OK`), dimmed when it was OK, so an OK
 * beside SCAN OVERDUE never reads as "all is well". A DEGRADED or FAILED run keeps its colour: that is a warning too.
 */
export function statusPills(scan, freshness) {
  const status = hasScan(scan) ? scan.run.status : 'no-scan';
  const label = scanStatusLabel(scan);
  if (!freshness?.overdue) return [text('span', label, { class: `status-pill status-${status}` })];
  return [overduePill(freshness), text('span', `LAST RUN ${label}`, { class: `status-pill status-${status} status-last-run` })];
}

function renderChrome(data) {
  clear(chrome);
  if (data.config?.demo) {
    chrome.appendChild(text('div', 'Demo. All holdings, prices and names are invented.', { class: 'demo-banner', attrs: { role: 'note' } }));
  }
  const now = Date.now();
  const freshness = hasScan(data.scan) ? freshnessOf(data, now) : null;
  // T3.1b (docs/phase3-plan.md §3, §8 resolution 2): a body class, not CSS
  // :has(), so hud.css can turn every panel's frame red while overdue and
  // add the degraded strip to #chrome without a per-render class dance.
  // Named page-overdue/page-degraded, not scan-overdue/scan-degraded (the
  // plan's own placeholder wording) — scan-age.js's SCAN OVERDUE pill already
  // owns the `.scan-overdue` class, and a second element with the same class
  // would break `document.querySelector('.scan-overdue')` call sites.
  document.body.classList.toggle('page-overdue', Boolean(freshness?.overdue));
  document.body.classList.toggle('page-degraded', hasScan(data.scan) && data.scan.run.status === 'degraded');
  applyMotionClass();
  const bar = el('div', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      brandMark(),
      text('span', 'Command Center', { class: 'app-name' }),
    ]),
    text('span', lastScanText(data.scan, freshness?.age), { class: `last-scan ${freshness?.overdue ? 'stale' : 'muted'}` }),
    ...statusPills(data.scan, freshness),
    freshnessPill(data.state, now),
  ]);
  // Segmented nav, filled active state (docs/phase3-visual-plan.md §3.3/V2): aria-current="page" on the link
  // matching the current hash — both the CSS hook for the fill and a real accessibility improvement (the topnav
  // had no active-state signal of any kind before this task). Same "compare the raw hash" pattern renderBottomNav
  // already uses just below, not router.js's parsed route — a dossier route (#/p/<ticker>) matches none of these
  // five links, same as renderBottomNav's own "Positions" behaviour today (docs/phase3-plan.md §8 resolution,
  // item 2, still unconfirmed — not this task's to invent a new active state for).
  const currentHash = window.location.hash && window.location.hash !== '#' ? window.location.hash : '#/';
  // `#/positions` is the command view too (opened at its holdings), so the top nav's Command link is the current page there.
  const navLink = (href, label) => el('a', { attrs: { href, ...(currentHash === href || (href === '#/' && currentHash === '#/positions') ? { 'aria-current': 'page' } : {}) }, text: label });
  const nav = el('nav', { class: 'topnav' }, [
    navLink('#/', 'Command'),
    navLink('#/watchlist', 'Watchlist'),
    navLink('#/journal', 'Journal'),
    navLink('#/scan', 'Scan'),
    navLink('#/state', 'State'),
    navLink('#/settings', 'Settings'),
  ]);
  chrome.appendChild(bar);
  const banner = staleBanner(freshness);
  if (banner) chrome.appendChild(banner);
  const cacheNotice = cachedBanner(data.cachedAt);
  if (cacheNotice) chrome.appendChild(cacheNotice);
  chrome.appendChild(nav);
}

export { JOURNAL_PLACEHOLDER };

function renderRoute(data, route) {
  clear(app);
  app.className = '';
  app.removeAttribute('style'); // splitLayout's per-page grid rows (dom.js) must not carry over to the next route
  switch (route.name) {
    case 'command':
    case 'positions': {
      const triggerFilter = pendingTriggerFilter;
      pendingTriggerFilter = null;
      renderCommand(app, data, { triggerFilter, onClearTriggerFilter: () => renderRoute(data, route), focus: route.name === 'positions' ? 'holdings' : null });
      return;
    }
    case 'position':
      renderPosition(app, data, route.params.ticker);
      return;
    case 'watchlist':
      renderWatchlist(app, data);
      return;
    case 'watchlist-dossier':
      renderWatchlistDossier(app, data, route.params.ticker);
      return;
    case 'state':
      renderState(app, data);
      return;
    case 'scan':
      renderScan(app, data);
      return;
    case 'settings':
      renderSettings(app, data.config);
      return;
    case 'journal':
      renderJournal(app, data);
      return;
    case 'journal-detail':
      renderJournalEntry(app, data, route.params.id);
      return;
    default:
      app.appendChild(text('p', `Unknown route: ${location.hash}`, { class: 'muted' }));
  }
}

/** Service worker kill switch (2026-09-23, the owner): nothing registers sw.js any more, and any registration left on
 * this device from the T3.5b worker is removed here, on every load — this still works if sw.js's own self-
 * unregistering update can't be fetched (e.g. an expired Cloudflare Access session answers it with a redirect,
 * which a worker update refuses). Fire and forget: it never blocks or delays boot(), and a browser without the API
 * or with nothing registered does nothing. See site/sw.js for why. */
export function removeServiceWorkers(nav = navigator, cacheStorage = globalThis.caches) {
  const unregister = nav.serviceWorker?.getRegistrations
    ? nav.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
    : Promise.resolve();
  // The old worker's copy of the data files. Nothing reads it any more, and it is portfolio data left on the device.
  const dropCaches = cacheStorage?.keys
    ? cacheStorage.keys().then((names) => Promise.all(names.filter((n) => n.startsWith('command-center-data')).map((n) => cacheStorage.delete(n))))
    : Promise.resolve();
  return Promise.all([unregister, dropCaches]).catch(() => {
    // Storage blocked, private mode quirks, or similar — nothing is stored there to remove.
  });
}

/**
 * Current holdings at the scan's prices (#91) and alerts re-gated against the current cash (#92), for the scan and the
 * close the levels come from. `prevClose` stays as published: it is only read for what an alert or a level said then.
 */
export function withLiveData(data) {
  return { ...data, scan: withLiveState(data.scan, data.state, data.prevClose), lastClose: withLiveState(data.lastClose, data.state, data.prevClose) };
}

export async function boot() {
  removeServiceWorkers();
  app.appendChild(text('p', 'Loading…', { class: 'muted' }));
  let loaded = await loadData();
  // A demo build keeps itself current: its invented dates move to today's latest close (demo-shift.js). The real
  // site never loads that module.
  if (loaded.config?.demo === true) loaded = await (await import('./demo-shift.js')).keepDemoCurrent(loaded);
  // The book's currency and its accounts' display names, before anything is computed or drawn
  // (lib/base-currency.js): NOK and the account ids unless the state says otherwise.
  setAccounts(loaded.state?.portfolio);
  const data = withLiveData(loaded);
  if (shouldBoot({ demo: Boolean(data.config?.demo) })) await runBoot(document.body);
  renderChrome(data);
  renderRoute(data, currentRoute());
  renderBottomNav(data);

  // The age is counted to the moment of the view, so a page left open, or a tab brought back to the front, is redrawn.
  onRouteChange((route) => { renderChrome(data); scrollToTop(); renderRoute(data, route); renderBottomNav(data); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderChrome(data); });
  return data;
}

// Auto-start for the real page load; tests await this exported promise
// instead of guessing timing.
export const ready = boot();
