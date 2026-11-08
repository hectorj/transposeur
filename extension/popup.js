const api = globalThis.browser ?? globalThis.chrome;

const pitch = document.getElementById('pitch');
const rate = document.getElementById('rate');
const pitchVal = document.getElementById('pitchVal');
const rateVal = document.getElementById('rateVal');
const status = document.getElementById('status');

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Inject (idempotently) and call one method of window.__pitchShifter in every
 * frame, then report the state of whichever frame actually holds the media.
 */
async function drive(method, arg = null) {
  const tab = await activeTab();
  if (!tab?.id) return null;
  const target = { tabId: tab.id, allFrames: true };
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

const label = () => {
  const s = Number(pitch.value);
  pitchVal.textContent = s > 0 ? `+${s}` : String(s);
  rateVal.textContent = `${rate.value}%`;
};

const send = debounce(async () => {
  const settings = { semitones: Number(pitch.value), rate: Number(rate.value) / 100 };
  await api.storage.local.set(settings);
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

document.getElementById('reset').addEventListener('click', async () => {
  pitch.value = 0;
  rate.value = 100;
  label();
  await api.storage.local.set({ semitones: 0, rate: 1 });
  render(await drive('reset'));
});

(async () => {
  const saved = await api.storage.local.get({ semitones: 0, rate: 1 });
  pitch.value = saved.semitones;
  rate.value = Math.round(saved.rate * 100);
  label();
  render(await drive('state'));
})();
