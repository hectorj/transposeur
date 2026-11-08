import { DEFAULTS, isDefault, load, save, clear } from './settings.js';

const api = globalThis.browser ?? globalThis.chrome;

const pitch = document.getElementById('pitch');
const rate = document.getElementById('rate');
const pitchVal = document.getElementById('pitchVal');
const rateVal = document.getElementById('rateVal');
const status = document.getElementById('status');

/** The tab this popup acts on, resolved once when it opens. */
let tabId = null;

/**
 * Inject (idempotently) and call one method of window.__pitchShifter in every
 * frame, then report the state of whichever frame actually holds the media.
 */
async function drive(method, arg = null) {
  if (tabId == null) return null;
  const target = { tabId, allFrames: true };
  try {
    await api.scripting.executeScript({ target, files: ['content.js'] });
    const results = await api.scripting.executeScript({
      target,
      args: [method, arg],
      func: (m, a) => (window.__pitchShifter ? window.__pitchShifter[m](a) : null),
    });
    const states = results.map((r) => r.result).filter(Boolean);
    return states.find((s) => s.hasMedia) ?? states[0] ?? null;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function render(state) {
  if (!state) {
    status.textContent = 'no access to this page';
    status.className = 'err';
    return;
  }
  if (!state.ok) {
    status.textContent = state.error;
    status.className = 'err';
    return;
  }
  status.className = '';
  if (!state.hasMedia) {
    status.textContent = 'no audio or video found';
  } else if (state.active) {
    status.textContent = `shifting · ${state.latencyMs} ms delay`;
  } else {
    status.textContent = 'ready';
  }
}

/**
 * Semitones, with the equivalent in tones spelled out — musicians think in
 * tones, and a bare "+3" reads as three of whatever the slider counts.
 */
function pitchLabel(semitones) {
  if (semitones === 0) return '0';
  const n = Math.abs(semitones);
  const whole = Math.floor(n / 2);
  const half = n % 2;
  const tones = whole
    ? `${whole}${half ? '½' : ''} tone${whole > 1 || half ? 's' : ''}`
    : '½ tone';
  return `${semitones > 0 ? '+' : '−'}${n} (${tones})`;
}

const label = () => {
  pitchVal.textContent = pitchLabel(Number(pitch.value));
  rateVal.textContent = `${rate.value}%`;
  for (const button of document.querySelectorAll('.step')) {
    const slider = document.getElementById(button.dataset.target);
    const next = Number(slider.value) + Number(button.dataset.delta);
    button.disabled = next < Number(slider.min) || next > Number(slider.max);
  }
};

const current = () => ({ semitones: Number(pitch.value), rate: Number(rate.value) / 100 });

function show({ semitones, rate: playbackRate }) {
  pitch.value = String(semitones);
  rate.value = String(Math.round(playbackRate * 100));
  label();
}

const send = debounce(async () => {
  const settings = current();
  await save(api, tabId, settings);
  render(await drive('apply', settings));
}, 60);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

for (const el of [pitch, rate]) {
  el.addEventListener('input', () => {
    label();
    send();
  });
}

/** Nudge a slider by one step; the sliders themselves are coarse to drag. */
function nudge(slider, delta) {
  const next = Math.min(Number(slider.max), Math.max(Number(slider.min), Number(slider.value) + delta));
  if (next === Number(slider.value)) return;
  slider.value = String(next);
  label();
  send();
}

for (const button of document.querySelectorAll('.step')) {
  button.addEventListener('click', () => {
    nudge(document.getElementById(button.dataset.target), Number(button.dataset.delta));
  });
}

document.getElementById('reset').addEventListener('click', async () => {
  show(DEFAULTS);
  await clear(api, tabId);
  render(await drive('reset'));
});

(async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  if (tabId == null) {
    render(null);
    return;
  }
  const saved = await load(api, tabId);
  show(saved);
  // Re-apply rather than only reading state: a reload or a YouTube in-page
  // navigation drops the audio graph, and this tab's settings should survive it.
  render(isDefault(saved) ? await drive('state') : await drive('apply', saved));
})();
