import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, watchErrors } from './lib/browser.mjs';
import {
  voiceLike,
  sine,
  dominantHz,
  fundamentalHz,
  spectralCentroidHz,
  activeRegion,
  semitoneRatio,
} from './lib/dsp.mjs';
import { FORMANT_BASE_HZ } from '../extension/shifter-config.js';

const SR = 48000;
/** Formant resonances of a mid-range sung vowel, held fixed by construction. */
const FORMANTS = [
  { hz: 700, q: 8, gain: 1 },
  { hz: 1150, q: 10, gain: 0.55 },
  { hz: 2700, q: 12, gain: 0.25 },
];

let srv;
let browser;
let page;
let errors;

before(async () => {
  srv = await startServer();
  browser = await launchBrowser();
  page = await browser.newPage();
  errors = watchErrors(page);
  await page.goto(`${srv.origin}/harness.html`);
  await page.waitForFunction('window.harnessReady === true', null, { timeout: 30000 });
});

after(async () => {
  await browser?.close();
  await srv?.close();
});

/** Renders through the real WASM worklet and returns the steady-state middle. */
async function shift(input, opts) {
  const out = await page.evaluate((a) => window.renderShift(a), {
    samples: Array.from(input),
    sampleRate: SR,
    ...opts,
  });
  assert.equal(out.samples.length, input.length + SR, 'render length should be input + 1s tail');
  return {
    all: Float32Array.from(out.samples),
    // skip the node's startup latency and the tail
    steady: Float32Array.from(out.samples.slice(Math.round(SR * 0.7), input.length - Math.round(SR * 0.2))),
    latencyMs: out.latency * 1000,
  };
}

const voice = (f0) =>
  voiceLike({ f0, sampleRate: SR, seconds: 3, vibratoCents: 35, jitterCents: 8, formants: FORMANTS });

const cents = (a, b) => 1200 * Math.log2(a / b);

describe('pitch accuracy', () => {
  for (const semitones of [-12, -5, 2, 7, 12]) {
    test(`a 440 Hz tone shifts by exactly ${semitones} semitones`, async () => {
      const out = await shift(sine({ hz: 440, sampleRate: SR, seconds: 2 }), { semitones });
      const want = 440 * semitoneRatio(semitones);
      const got = dominantHz(out.steady, SR);
      assert.ok(
        Math.abs(cents(got, want)) < 15,
        `got ${got.toFixed(1)} Hz, want ${want.toFixed(1)} Hz (${cents(got, want).toFixed(0)} cents off)`
      );
    });
  }

  test('zero semitones leaves the pitch alone', async () => {
    const out = await shift(sine({ hz: 440, sampleRate: SR, seconds: 2 }), { semitones: 0 });
    assert.ok(Math.abs(cents(dominantHz(out.steady, SR), 440)) < 5);
  });
});

describe('no chipmunk effect', () => {
  // Brightness (spectral centroid) is what makes a naively shifted voice sound
  // like a chipmunk: a naive shifter scales the whole spectrum, formants and
  // all, so brightness tracks the pitch ratio. Formant compensation must not.
  for (const f0 of [110, 220]) {
    for (const semitones of [5, -5]) {
      test(`f0 ${f0} Hz, ${semitones > 0 ? '+' : ''}${semitones} semitones keeps the voice's brightness`, async () => {
        const input = voice(f0);
        const inBrightness = spectralCentroidHz(
          Float32Array.from(input.slice(Math.round(SR * 0.7), input.length - Math.round(SR * 0.2))),
          SR
        );
        const ratio = semitoneRatio(semitones);

        const compensated = await shift(input, {
          semitones,
          formantCompensation: true,
          formantBaseHz: FORMANT_BASE_HZ,
        });
        const naive = await shift(input, { semitones });

        const compDrift = spectralCentroidHz(compensated.steady, SR) / inBrightness;
        const naiveDrift = spectralCentroidHz(naive.steady, SR) / inBrightness;

        // the pitch still has to move, by the full amount
        const wantF0 = fundamentalHz(
          Float32Array.from(input.slice(Math.round(SR * 0.7), input.length - Math.round(SR * 0.2))),
          SR
        ).hz * ratio;
        const gotF0 = fundamentalHz(compensated.steady, SR).hz;
        assert.ok(
          Math.abs(cents(gotF0, wantF0)) < 25,
          `pitch should move: got ${gotF0.toFixed(1)} Hz, want ${wantF0.toFixed(1)} Hz`
        );

        assert.ok(
          Math.abs(compDrift - 1) < 0.1,
          `brightness should hold: drifted to ${compDrift.toFixed(3)}x`
        );
        assert.ok(
          Math.abs(naiveDrift - 1) > 2 * Math.abs(compDrift - 1),
          `compensation must beat the naive shift clearly: naive ${naiveDrift.toFixed(3)}x vs compensated ${compDrift.toFixed(3)}x`
        );
      });
    }
  }
});

describe('tempo is untouched by the pitch shifter', () => {
  test('a 1 s burst stays 1 s long after a +7 semitone shift', async () => {
    const burst = sine({
      hz: 440,
      sampleRate: SR,
      seconds: 2.5,
      gate: (t) => (t > 0.5 && t < 1.5 ? 1 : 0),
    });
    const out = await shift(burst, { semitones: 7, formantCompensation: true, formantBaseHz: FORMANT_BASE_HZ });

    const [start, end] = activeRegion(out.all, SR, 0.3);
    const duration = end - start;
    assert.ok(
      Math.abs(duration - 1) < 0.08,
      `burst should still last ~1 s, measured ${duration.toFixed(3)} s`
    );
    // and it must arrive only as late as the node's own reported latency
    assert.ok(
      start >= 0.5 && start < 0.5 + out.latencyMs / 1000 + 0.05,
      `burst onset ${start.toFixed(3)} s should sit within the reported ${out.latencyMs.toFixed(0)} ms latency of 0.5 s`
    );
  });
});

describe('latency', () => {
  test('is reported and stays small enough for watching video', async () => {
    const out = await shift(sine({ hz: 440, sampleRate: SR, seconds: 1 }), { semitones: 3 });
    assert.ok(out.latencyMs > 0, 'the node should report its latency');
    assert.ok(out.latencyMs < 200, `latency ${out.latencyMs.toFixed(0)} ms is too high for A/V sync`);
  });
});

describe('cleanliness', () => {
  test('no page errors were logged during any render', () => {
    assert.deepEqual(errors, []);
  });
});
