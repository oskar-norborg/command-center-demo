// Mic (SPEC.md §5.10, docs/phase3-plan.md §7 T3.6): the Web Speech API,
// started by a tap (a user gesture, required on iOS), matched against
// site/app/lib/voice-grammar.js. Hidden entirely — not just disabled — when the
// browser has no `webkitSpeechRecognition`/`SpeechRecognition`, per SPEC.md
// §5.10 ("the mic button is hidden and settings say why"). No audio leaves
// the device except through the browser's own recognition service, which
// settings.js discloses next to the toggle — this file never sends the
// audio or the transcript anywhere itself.
import { el, text } from '../dom.js';
import { matchVoiceCommand, ALIASES } from '../lib/voice-grammar.js';

/** True only where a speech recognizer actually exists — the sole gate for showing the mic anywhere (button, settings explanation). */
export function voiceSupported() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function';
}

function recognizer() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const r = new Ctor();
  r.lang = 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

/**
 * @param {object} args
 * @param {{ticker: string, name?: string}[]} args.names   every position/watchlist entry "show me"/"open" may resolve to
 * @param {(command: ReturnType<typeof matchVoiceCommand>) => void} args.onCommand
 * @returns {HTMLElement|null}   null when the API is missing — nothing to render at all, not a disabled button
 */
export function micButton({ names, onCommand }) {
  if (!voiceSupported()) return null;

  const button = el('button', { class: 'mic-button', attrs: { type: 'button', 'aria-label': 'Voice command' } }, [text('span', '\u{1F3A4}')]);
  const status = el('div', { class: 'mic-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  status.hidden = true;

  let recognition = null;

  const showUnmatched = (transcript) => {
    status.hidden = false;
    status.textContent = '';
    status.appendChild(text('p', transcript ? `Heard: "${transcript}" — didn't match a command.` : 'Didn’t catch that.'));
    status.appendChild(text('p', `Try: ${ALIASES.join(' · ')}`, { class: 'muted' }));
  };

  button.addEventListener('click', () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    status.hidden = true;
    button.classList.add('listening');
    recognition = recognizer();
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? '';
      const command = matchVoiceCommand(transcript, { names });
      if (command.type === 'unmatched') showUnmatched(transcript);
      else { status.hidden = true; onCommand(command); }
    };
    recognition.onerror = () => { status.hidden = false; status.textContent = ''; status.appendChild(text('p', 'Voice command failed or was denied microphone access.')); };
    recognition.onend = () => { button.classList.remove('listening'); recognition = null; };
    recognition.start();
  });

  return el('div', { class: 'mic-wrap' }, [button, status]);
}
