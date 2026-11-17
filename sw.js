// Kill switch (2026-09-23, the owner): the live site showed tens of thousands of pending app/*.js requests per page
// load, attributed in Chrome to the service worker. While that is investigated, the site runs with no service
// worker at all: main.js no longer registers one (and unregisters any it finds), and this file replaces the
// data-caching worker from T3.5b on every device that still has it.
//
// A browser that has the old worker checks this URL for an update on its next visit, sees a changed file, and
// installs this one. It then activates at once, deletes the data caches the old worker kept, and unregisters
// itself. It has no fetch handler, so from the moment it installs every request goes straight to the network.
// It deliberately does not reload or navigate open pages: a worker that reloads its clients is one bad condition
// away from a reload loop, which is the opposite of what this file is for. The next ordinary page load is simply
// uncontrolled.
//
// Offline caching of the data files (the cyan "cached <time>" banner) is off until this is resolved; the
// T3.5b worker is in git history (705a052) to restore from.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('command-center-data')).map((n) => caches.delete(n)));
    await self.registration.unregister();
  })());
});
