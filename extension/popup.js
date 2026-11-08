import { DEFAULTS, isDefault, load, save, clear } from './settings.js';

const api = globalThis.browser ?? globalThis.chrome;

/** Falls back to the key, so a missing string shows up rather than going blank. */
const t = (key, ...subs) => api.i18n.getMessage(key, subs.map(String)) || key;

for (const el of document.querySelectorAll('[data-i18n]')) {
  el.textContent = t(el.dataset.i18n);
}
for (const el of document.querySelectorAll('[data-i18n-aria]')) {
  el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

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
    status.textContent = t('statusNoAccess');
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
    status.textContent = t('statusNoMedia');
  } else if (state.active) {
    status.textContent = t('statusShifting', state.latencyMs);
  } else {
    status.textContent = t('statusReady');
  }
}

/**
 * Semitones, with the equivalent in tones spelled out — musicians think in
 * tones, and a bare "+3" reads as three of whatever the slider counts.
 *
 * Which plural form applies is language-specific and not guessable: English
 * says "1½ tones", French says "1½ ton", because French counts anything below
 * two as singular. Intl.PluralRules knows both, so neither is hard-coded.
 *
 * The locale comes from the catalogue rather than from getUILanguage() or
 * @@ui_locale: both can report en-US while getMessage is serving French, and
 * then the rules would not match the words they are inflecting.
 */
const plural = (() => {
  try {
    return new Intl.PluralRules(t('localeTag'));
  } catch {
    return new Intl.PluralRules('en');
  }
})();

function pitchLabel(semitones) {
  if (semitones === 0) return '0';
  const n = Math.abs(semitones);
  const tones = n / 2;
  const sign = semitones > 0 ? '+' : '−';
  // Half a tone sits outside the plural rules: English would call it "½ tones".
  if (tones === 0.5) return `${sign}${n} (${t('halfTone')})`;
  const amount = `${Math.floor(tones)}${n % 2 ? '½' : ''}`;
  return `${sign}${n} (${t(plural.select(tones) === 'one' ? 'tonesOne' : 'tonesOther', amount)})`;
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
