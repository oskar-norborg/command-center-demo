// Settings (`#/settings`, SPEC.md §5.1/§4.7) — first real build, T3.4: boot
// on/off and the reduced-motion override, both localStorage, taking effect
// without a reload. Voice on/off is added by T3.6 alongside the mic feature
// itself (docs/phase3-plan.md §4.7 — "a settings page with nothing to toggle
// yet has nothing to style").
import { el, text, clear } from '../dom.js';
import { BOOT_ENABLED_KEY, bootEnabled } from '../components/boot.js';
import { prefersReducedMotion } from '../lib/animate.js';
import { voiceSupported } from '../components/mic.js';
import { setVisuals, visualsOn } from '../components/charts.js';

export const MOTION_KEY = 'reduced-motion';

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: the toggle just does not persist past this page view.
  }
}

/** `'on'` (always reduced), `'off'` (always full motion), or `null` (follow the OS setting) — site/app/lib/animate.js reads the same key. */
export function motionOverride() {
  const v = readLocalStorage(MOTION_KEY);
  return v === 'on' || v === 'off' ? v : null;
}

export const VOICE_ENABLED_KEY = 'voice-enabled';

/** False only when this setting explicitly turned the mic off; on by default wherever the API exists (SPEC.md §5.10) — main.js's bottom nav checks this before ever building the mic button. */
export function voiceEnabled() {
  return readLocalStorage(VOICE_ENABLED_KEY) !== 'off';
}

/** Applies the current motion setting to `<body>` immediately — CSS (hud.css's `.pulsing` rules) reads this class
 * for the settings override, since a media query alone cannot see localStorage. Called on every render (main.js)
 * and right after this page changes the setting, so it takes effect with no reload (T3.4 DoD). */
export function applyMotionClass() {
  document.body.classList.toggle('reduced-motion', prefersReducedMotion());
}

function toggleRow(labelText, checked, onChange) {
  const input = el('input', { attrs: { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) } });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'settings-toggle' }, [input, text('span', ` ${labelText}`)]);
}

function radioRow(name, value, current, labelText, onChange) {
  const input = el('input', { attrs: { type: 'radio', name, value, ...(current === value ? { checked: 'checked' } : {}) } });
  input.addEventListener('change', () => { if (input.checked) onChange(value); });
  return el('label', { class: 'settings-radio' }, [input, text('span', ` ${labelText}`)]);
}

export function renderSettings(container, config = null) {
  clear(container);
  container.appendChild(text('h1', 'Settings'));

  const bootPanel = el('section', { class: 'panel' }, [text('h2', 'Boot sequence')]);
  bootPanel.appendChild(toggleRow('Show the boot sequence once per day', bootEnabled(), (checked) => {
    writeLocalStorage(BOOT_ENABLED_KEY, checked ? 'on' : 'off');
  }));
  bootPanel.appendChild(text('p', 'Always shown on the demo build, and never shown with reduced motion on, whatever this says.', { class: 'muted' }));
  container.appendChild(bootPanel);

  const motionPanel = el('section', { class: 'panel' }, [text('h2', 'Motion')]);
  const current = motionOverride();
  const onMotionChange = (value) => {
    writeLocalStorage(MOTION_KEY, value === 'system' ? null : value);
    applyMotionClass();
  };
  motionPanel.appendChild(el('div', { class: 'settings-radio-group' }, [
    radioRow('motion', 'system', current ?? 'system', 'Follow this device’s reduced-motion setting', onMotionChange),
    radioRow('motion', 'off', current ?? 'system', 'Full motion, always', onMotionChange),
    radioRow('motion', 'on', current ?? 'system', 'Reduced motion, always', onMotionChange),
  ]));
  motionPanel.appendChild(text('p', 'Rings, count-up numbers, the boot sequence and pulsing alerts all read this.', { class: 'muted' }));
  container.appendChild(motionPanel);

  const visualsPanel = el('section', { class: 'panel' }, [text('h2', 'Experimental visuals')]);
  visualsPanel.appendChild(toggleRow('Show the charts: book over time, distance to levels, price and levels', visualsOn(config), (checked) => {
    setVisuals(checked);
  }));
  visualsPanel.appendChild(text('p', 'On by default in the demo, off here until you turn it on. The charts draw published scan figures only.', { class: 'muted' }));
  container.appendChild(visualsPanel);

  container.appendChild(voicePanel());

  container.appendChild(offlinePanel());
}

// --- Voice (SPEC.md §5.10, docs/phase3-plan.md T3.6) -----------------------

function voicePanel() {
  const p = el('section', { class: 'panel' }, [text('h2', 'Voice')]);
  if (!voiceSupported()) {
    p.appendChild(text('p', 'Not available: this browser has no speech recognition. The mic button is hidden.', { class: 'muted' }));
    return p;
  }
  p.appendChild(toggleRow('Show the mic button', voiceEnabled(), (checked) => {
    writeLocalStorage(VOICE_ENABLED_KEY, checked ? 'on' : 'off');
  }));
  p.appendChild(text('p', 'Recognises speech using this browser’s own recognition service — no audio leaves the device any other way, and nothing here records or stores it.', { class: 'muted' }));
  return p;
}

// --- Offline (SPEC.md §7.1/phase 3.5, docs/phase3-plan.md §5, T3.5b) -------

/** Every Cache Storage entry sw.js made (its own cache name, matched by prefix so a future version bump — e.g. `command-center-data-v2` — is still found and cleared by an older page still running this code). */
async function clearCachedData() {
  if (typeof caches === 'undefined') return false;
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith('command-center-data')).map((n) => caches.delete(n)));
  return true;
}

function offlinePanel() {
  const p = el('section', { class: 'panel' }, [text('h2', 'Offline')]);
  p.appendChild(text('p', 'The last-seen state, scan and findings are cached on this device so the app still shows something with no connection.', { class: 'muted' }));
  const status = text('p', '', { class: 'muted' });
  const button = el('button', { class: 'settings-button', text: 'Clear cached data' });
  button.addEventListener('click', async () => {
    button.disabled = true;
    const cleared = await clearCachedData();
    status.textContent = cleared ? 'Cleared. The next time you’re online, it will cache again.' : 'Offline caching is not available in this browser.';
    button.disabled = false;
  });
  p.appendChild(button);
  p.appendChild(status);
  return p;
}
