import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/browser.mjs';
import { startGeckodriver, FirefoxSession } from './lib/webdriver.mjs';
import { semitoneRatio } from './lib/dsp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let srv;
let driver;
let session;
let extensionDir;

const cents = (a, b) => 1200 * Math.log2(a / b);

/** Where the browser log stood before the deliberately hostile CSP test. */
let logMark = null;

/**
 * Stages the built Firefox extension for testing. Two changes, both forced by
 * what a WebDriver session cannot do:
 *
 *  - `activeTab` is only granted by a real toolbar click, so the copy gets an
 *    explicit host permission and content.js is registered statically.
 *  - geckodriver refuses to execute scripts in privileged moz-extension pages,
 *    so the popup cannot be driven. `ff-bridge.js` (test-only, from tests/)
 *    relays calls from the page into the content script's sandbox instead.
 *
 * content.js itself is byte-identical to the shipped file. The popup's own
 * wiring is the same code in both browsers and is covered by the Chrome suite.
 */
async function stageExtension() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pitch-shifter-ff-'));
  await fs.cp(path.join(root, 'dist/firefox'), tmp, { recursive: true });
  await fs.cp(path.join(root, 'tests/fixtures/ff-bridge.js'), path.join(tmp, 'ff-bridge.js'));
  const mfPath = path.join(tmp, 'manifest.json');
  const mf = JSON.parse(await fs.readFile(mfPath, 'utf8'));
  // match patterns carry no port, and matching ignores it
  mf.host_permissions = ['http://127.0.0.1/*'];
  mf.content_scripts = [
    {
      matches: ['http://127.0.0.1/*'],
      js: ['content.js', 'ff-bridge.js'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ];
  await fs.writeFile(mfPath, JSON.stringify(mf, null, 2));
  return tmp;
}

const DRIVE_SCRIPT = `
  const [method, arg, done] = arguments;
  const id = String(Math.random());
  const onResult = (event) => {
    const data = JSON.parse(event.detail);
    if (data.id !== id) return;
    document.removeEventListener('pitch-shifter-test-result', onResult);
    done(data);
  };
  document.addEventListener('pitch-shifter-test-result', onResult);
  document.dispatchEvent(
    new CustomEvent('pitch-shifter-test', { detail: JSON.stringify({ id, method, arg }) })
  );
`;

async function drive(method, arg = null) {
  const out = await session.executeAsync(DRIVE_SCRIPT, [method, arg]);
  assert.ok(out.ok, `driving the content script failed: ${out.error}`);
  return out.result;
}

async function openMedia(pathname) {
  await session.navigate(`${srv.origin}${pathname}`);
  await session.execute("return document.getElementById('clip').play(), null");
  await session.waitFor("return document.getElementById('clip').currentTime > 0.2", [], {
    message: `playback to start on ${pathname}`,
  });
}

before(async () => {
  assert.ok(
    await fs.stat(path.join(root, 'dist/firefox')).catch(() => null),
    'run `npm run build` first (npm test does it for you)'
  );
  srv = await startServer();
  extensionDir = await stageExtension();
  driver = await startGeckodriver();
  session = await FirefoxSession.create(driver.base);
  await session.installAddon(extensionDir);
  const [handle] = await session.handles();
  await session.switchTo(handle);
});

after(async () => {
  await session?.quit().catch(() => {});
  driver?.kill();
  await srv?.close();
  if (extensionDir) await fs.rm(extensionDir, { recursive: true, force: true });
});

describe('the Firefox build, in Firefox', () => {
  test('the content script loads its WASM module and taps the media element', async () => {
    await openMedia('/media.html');
    const state = await drive('apply', { semitones: 5, rate: 0.75 });
    assert.equal(state.error, null, 'the content script should not have errored');
    assert.equal(state.ok, true);
    assert.equal(state.hasMedia, true);
    assert.equal(state.active, true, 'the shifter should be in the audio path');
    assert.equal(state.semitones, 5);
    assert.equal(state.rate, 0.75);
    assert.equal(state.contextState, 'running', 'the AudioContext must not be left suspended');
    assert.ok(state.latencyMs > 0 && state.latencyMs < 200, `latency ${state.latencyMs} ms`);
  });

  test('applies tempo through the media element', async () => {
    const el = await session.execute(`
      const clip = document.getElementById('clip');
      return { playbackRate: clip.playbackRate, preservesPitch: clip.preservesPitch, paused: clip.paused };
    `);
    assert.equal(el.playbackRate, 0.75);
    assert.equal(el.preservesPitch, true);
    assert.equal(el.paused, false);
  });

  test('playback keeps progressing while shifted', async () => {
    const before = await session.execute("return document.getElementById('clip').currentTime");
    await session.waitFor(
      'return document.getElementById("clip").currentTime > arguments[0] + 0.3',
      [before],
      { message: 'playback to advance while shifted' }
    );
  });

  test('reset puts the media element back to normal', async () => {
    const state = await drive('reset');
    assert.equal(state.semitones, 0);
    assert.equal(state.rate, 1);
    assert.equal(state.active, false, 'the shifter should leave the audio path when reset');
    assert.equal(await session.execute("return document.getElementById('clip').playbackRate"), 1);
  });

  test('audio still plays after the shifter is bypassed', async () => {
    const before = await session.execute("return document.getElementById('clip').currentTime");
    await session.waitFor(
      'return document.getElementById("clip").currentTime > arguments[0] + 0.3',
      [before],
      { message: 'playback to advance after bypass' }
    );
  });

  test("works on a page with youtube.com's Content-Security-Policy", async () => {
    await openMedia('/strict/media.html');
    const state = await drive('apply', { semitones: 4, rate: 1 });
    assert.equal(state.error, null, 'a YouTube-like CSP must not block the worklet');
    assert.equal(state.active, true);
    assert.ok(state.latencyMs > 0);
  });

  test('fails fast with a clear message when a CSP forbids WebAssembly', async () => {
    logMark = driver.log.length; // everything past here is the blocked-WASM noise we asked for
    await openMedia('/nowasm/media.html');
    const state = await drive('apply', { semitones: 4, rate: 1 });
    assert.equal(state.ok, false);
    assert.match(state.error, /security policy/i);
    assert.equal(state.active, false, 'the audio must be left on the direct path');
  });
});

// Gecko has its own AudioWorklet and WASM implementations, so the DSP claims
// are re-measured here rather than assumed from the Chromium run. Metrics are
// computed in the page to avoid shipping whole buffers over WebDriver.
describe('the DSP, measured in Gecko', () => {
  before(async () => {
    await session.navigate(`${srv.origin}/dsp-metrics.html`);
    await session.waitFor('return window.metricsReady === true', [], {
      timeout: 30000,
      message: 'the metrics harness to load',
    });
  });

  for (const semitones of [-5, 7]) {
    test(`a 440 Hz tone shifts by exactly ${semitones} semitones`, async () => {
      const m = await session.executeAsync(
        'const [semitones, done] = arguments; window.measureTone({ hz: 440, semitones }).then(done);',
        [semitones]
      );
      const want = 440 * semitoneRatio(semitones);
      assert.ok(
        Math.abs(cents(m.outHz, want)) < 15,
        `got ${m.outHz.toFixed(1)} Hz, want ${want.toFixed(1)} Hz (${cents(m.outHz, want).toFixed(0)} cents off)`
      );
      assert.ok(m.latency > 0 && m.latency < 0.2, `latency ${m.latency}s`);
    });
  }

  test('a shifted voice keeps its brightness, where a naive shift does not', async () => {
    const m = await session.executeAsync(
      'const [done] = arguments; window.measureVoice({ f0: 110, semitones: 5 }).then(done);',
      []
    );
    const wantF0 = m.input.f0 * semitoneRatio(5);
    assert.ok(
      Math.abs(cents(m.compensated.f0, wantF0)) < 25,
      `pitch should move: got ${m.compensated.f0.toFixed(1)} Hz, want ${wantF0.toFixed(1)} Hz`
    );
    const compDrift = m.compensated.centroid / m.input.centroid;
    const naiveDrift = m.naive.centroid / m.input.centroid;
    assert.ok(Math.abs(compDrift - 1) < 0.1, `brightness drifted to ${compDrift.toFixed(3)}x`);
    assert.ok(
      Math.abs(naiveDrift - 1) > 2 * Math.abs(compDrift - 1),
      `naive ${naiveDrift.toFixed(3)}x vs compensated ${compDrift.toFixed(3)}x`
    );
  });
});

describe('browser console', () => {
  // Scoped to before the hostile-CSP test, which provokes a WASM CompileError
  // on purpose; every page up to that point must be clean.
  test('logged no errors on any page that should work', () => {
    const noise = driver.log
      .slice(0, logMark ?? driver.log.length)
      .join('')
      .split('\n')
      .filter((line) => /console\.error|JavaScript error|Uncaught/i.test(line));
    assert.deepEqual(noise, []);
  });
});
