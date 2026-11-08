import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchWithExtension } from './lib/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let srv;
let context;
let extensionDir;
let userDataDir;
let mediaPage;
let mediaErrors = [];

/**
 * `activeTab` is granted only when a real user opens the popup, which a test
 * harness cannot do — so the loaded copy gets an explicit host permission for
 * the fixture origin. Everything else (CSP, web_accessible_resources, the
 * worklet, the audio graph) is exercised exactly as shipped.
 */
async function stageExtension(origin) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pitch-shifter-ext-'));
  await fs.cp(path.join(root, 'dist/chrome'), tmp, { recursive: true });
  const mfPath = path.join(tmp, 'manifest.json');
  const mf = JSON.parse(await fs.readFile(mfPath, 'utf8'));
  mf.host_permissions = [`${origin}/*`];
  await fs.writeFile(mfPath, JSON.stringify(mf, null, 2));
  return tmp;
}

/** Waits until this popup tab's stored semitones reach `want` (undefined = cleared). */
function storedSemitones(page, want) {
  return page.waitForFunction(
    async (expected) => {
      const self = await chrome.tabs.getCurrent();
      const stored = await chrome.storage.session.get(`tab:${self.id}`);
      return (stored[`tab:${self.id}`]?.semitones ?? undefined) === expected;
    },
    want,
    { timeout: 5000 }
  );
}

/** The popup's own driver logic, run from an extension page against a known tab. */
async function driveFromExtension(page, tabId, method, arg) {
  return page.evaluate(
    async ([tabId, method, arg]) => {
      const api = globalThis.browser ?? globalThis.chrome;
      const target = { tabId, allFrames: true };
      await api.scripting.executeScript({ target, files: ['content.js'] });
      const results = await api.scripting.executeScript({
        target,
        args: [method, arg],
        func: (m, a) => (window.__pitchShifter ? window.__pitchShifter[m](a) : null),
      });
      return results.map((r) => r.result);
    },
    [tabId, method, arg]
  );
}

before(async () => {
  assert.ok(
    await fs.stat(path.join(root, 'dist/chrome')).catch(() => null),
    'run `npm run build` first (npm test does it for you)'
  );
  srv = await startServer();
  extensionDir = await stageExtension(srv.origin);
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pitch-shifter-profile-'));
  context = await launchWithExtension(extensionDir, userDataDir);

  mediaPage = await context.newPage();
  mediaPage.on('console', (m) => {
    if (m.type() === 'error') mediaErrors.push(m.text());
  });
  mediaPage.on('pageerror', (e) => mediaErrors.push(String(e)));
  await mediaPage.goto(`${srv.origin}/media.html`);
  await mediaPage.evaluate(() => document.getElementById('clip').play());
  await mediaPage.waitForFunction(() => document.getElementById('clip').currentTime > 0.2, null, {
    timeout: 10000,
  });
});

after(async () => {
  await context?.close();
  await srv?.close();
  for (const dir of [extensionDir, userDataDir]) {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('the packed extension', () => {
  let extPage;
  let tabId;
  let popupUrl;

  test('loads in Chromium and reports no install warnings', async () => {
    extPage = await context.newPage();
    await extPage.goto('chrome://extensions-internals/');
    const entries = JSON.parse(await extPage.evaluate(() => document.body.innerText));
    const mine = entries.find((e) => e.name === 'Pitch Shifter');
    assert.ok(mine, 'the extension should be installed');
    assert.deepEqual(mine.install_warnings ?? [], [], 'manifest should produce no install warnings');
    assert.equal(mine.registry_status, 'ENABLED');
    assert.deepEqual(
      mine.permissions.active.api.sort(),
      ['activeTab', 'scripting', 'storage'],
      'the extension should need no permissions beyond these'
    );

    popupUrl = `chrome-extension://${mine.id}/popup.html`;
    await extPage.goto(popupUrl);
    tabId = await extPage.evaluate(async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      const self = await api.tabs.getCurrent();
      const tabs = await api.tabs.query({});
      return tabs.filter((t) => t.id !== self.id).at(-1).id;
    });
    assert.ok(tabId > 0);
  });

  test('its popup UI renders the pitch and tempo controls', async () => {
    assert.equal(await extPage.inputValue('#pitch'), '0');
    assert.equal(await extPage.inputValue('#rate'), '100');
    assert.equal(await extPage.textContent('#pitchVal'), '0');
    assert.equal(await extPage.textContent('#rateVal'), '100%');
    assert.match(await extPage.textContent('.label'), /semitones/, 'the pitch unit must be stated');
  });

  test('ships a toolbar icon at every size both stores ask for', async () => {
    const mf = JSON.parse(await fs.readFile(path.join(root, 'dist/chrome/manifest.json'), 'utf8'));
    const wanted = ['16', '32', '48', '128'];
    assert.deepEqual(Object.keys(mf.icons).sort(), [...wanted].sort());
    assert.deepEqual(Object.keys(mf.action.default_icon).sort(), [...wanted].sort());

    for (const size of wanted) {
      const file = path.join(root, 'dist/chrome', mf.icons[size]);
      const png = await fs.readFile(file);
      assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} should be a PNG`);
      // IHDR carries the real dimensions, which must match what the manifest claims
      assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
      assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
    }
  });

  // The slider counts semitones; a musician asking for "a tone and a half"
  // needs to see that this is 3 of them, not 1.5.
  test('the pitch readout spells out the interval in tones', async () => {
    const readouts = {};
    for (const semitones of [1, 2, 3, -3, 12]) {
      await extPage.evaluate((value) => {
        const el = document.getElementById('pitch');
        el.value = String(value);
        el.dispatchEvent(new Event('input'));
      }, semitones);
      readouts[semitones] = await extPage.textContent('#pitchVal');
    }
    assert.deepEqual(readouts, {
      1: '+1 (\u00bd tone)',
      2: '+2 (1 tone)',
      3: '+3 (1\u00bd tones)',
      '-3': '\u22123 (1\u00bd tones)',
      12: '+12 (6 tones)',
    });
  });

  test('the +/- buttons step the sliders and stop at the ends', async () => {
    const press = async (target, delta, times) => {
      for (let i = 0; i < times; i++) {
        await extPage.click(`.step[data-target="${target}"][data-delta="${delta}"]`);
      }
      return extPage.inputValue(`#${target}`);
    };

    await extPage.evaluate(() => {
      for (const [id, v] of [['pitch', '0'], ['rate', '100']]) {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input'));
      }
    });

    assert.equal(await press('pitch', '1', 3), '3', 'three clicks of + is a tone and a half');
    assert.equal(await press('pitch', '-1', 5), '-2');
    assert.equal(await press('rate', '-5', 2), '90', 'tempo steps in 5% increments');

    // clamping: stepping exactly to the top of the range locks the button,
    // rather than letting it run past +12
    assert.equal(await press('pitch', '1', 14), '12', 'from -2, fourteen steps reaches the top');
    assert.equal(
      await extPage.isDisabled('.step[data-target="pitch"][data-delta="1"]'),
      true,
      'the + button should be disabled at the top of the range'
    );
    assert.equal(
      await extPage.isDisabled('.step[data-target="pitch"][data-delta="-1"]'),
      false,
      'the - button should still work there'
    );

    await extPage.evaluate(() => {
      const el = document.getElementById('pitch');
      el.value = '0';
      el.dispatchEvent(new Event('input'));
    });
  });

  // The bug this covers: settings used to live in one global bucket, so
  // changing the sliders on a silent tab armed whichever tab you opened next.
  test('each tab keeps its own pitch and tempo', async () => {
    await extPage.click('.step[data-target="pitch"][data-delta="1"]');
    await extPage.click('.step[data-target="pitch"][data-delta="1"]');
    await extPage.click('.step[data-target="pitch"][data-delta="1"]');
    assert.equal(await extPage.inputValue('#pitch'), '3');

    const otherTab = await context.newPage();
    await otherTab.goto(popupUrl);
    assert.equal(
      await otherTab.inputValue('#pitch'),
      '0',
      'a different tab must not inherit the first tab\u2019s transposition'
    );
    await otherTab.close();

    // the popup saves on a debounce, so wait for the write rather than racing it
    await storedSemitones(extPage, 3);
    await extPage.reload();
    assert.equal(await extPage.inputValue('#pitch'), '3', 'a tab remembers its own setting');
    assert.match(await extPage.textContent('#pitchVal'), /1\u00bd tones/);

    await extPage.click('#reset');
    assert.equal(await extPage.inputValue('#pitch'), '0');
    await storedSemitones(extPage, undefined);
    await extPage.reload();
    assert.equal(await extPage.inputValue('#pitch'), '0', 'reset clears the stored setting too');
  });

  test('builds the audio graph in the media page on demand', async () => {
    const states = await driveFromExtension(extPage, tabId, 'apply', { semitones: 5, rate: 0.75 });
    const state = states.find((s) => s?.hasMedia);
    assert.ok(state, `no frame reported media: ${JSON.stringify(states)}`);
    assert.equal(state.error, null, 'the content script should not have errored');
    assert.equal(state.ok, true);
    assert.equal(state.active, true, 'the shifter should be in the audio path');
    assert.equal(state.semitones, 5);
    assert.equal(state.rate, 0.75);
    assert.equal(state.contextState, 'running', 'the AudioContext must not be left suspended');
    assert.ok(state.latencyMs > 0 && state.latencyMs < 200, `latency ${state.latencyMs} ms`);
  });

  test('the WASM worklet loads under the page CSP without errors', () => {
    const relevant = mediaErrors.filter((e) => !e.includes('favicon'));
    assert.deepEqual(relevant, [], 'loading the worklet must not trip the page CSP');
  });

  test('tempo is applied through the media element, keeping audio and video in step', async () => {
    const el = await mediaPage.evaluate(() => {
      const clip = document.getElementById('clip');
      return { playbackRate: clip.playbackRate, preservesPitch: clip.preservesPitch, paused: clip.paused };
    });
    assert.equal(el.playbackRate, 0.75);
    assert.equal(el.preservesPitch, true, 'preservesPitch keeps the tempo change from re-pitching the audio');
    assert.equal(el.paused, false);
  });

  test('playback keeps progressing while shifted (the page is not left silent or stalled)', async () => {
    await mediaPage.bringToFront(); // a backgrounded tab gets throttled in headless
    const before = await mediaPage.evaluate(() => document.getElementById('clip').currentTime);
    await mediaPage.waitForFunction(
      (t) => document.getElementById('clip').currentTime > t + 0.3,
      before,
      { timeout: 10000 }
    );
  });

  test('reset puts the media element back to normal', async () => {
    const states = await driveFromExtension(extPage, tabId, 'reset', null);
    const state = states.find((s) => s?.hasMedia);
    assert.equal(state.semitones, 0);
    assert.equal(state.rate, 1);
    assert.equal(state.active, false, 'the shifter should leave the audio path when reset');
    const rate = await mediaPage.evaluate(() => document.getElementById('clip').playbackRate);
    assert.equal(rate, 1);
  });

  test('audio still plays after the shifter is bypassed', async () => {
    await mediaPage.bringToFront();
    const before = await mediaPage.evaluate(() => document.getElementById('clip').currentTime);
    await mediaPage.waitForFunction(
      (t) => document.getElementById('clip').currentTime > t + 0.3,
      before,
      { timeout: 10000 }
    );
  });

  /** Opens a fixture media page (optionally behind a CSP) and shifts it. */
  async function shiftPageAt(pathPrefix) {
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.origin}${pathPrefix}/media.html`);
    await page.evaluate(() => document.getElementById('clip').play());
    await page.waitForFunction(() => document.getElementById('clip').currentTime > 0.2, null, {
      timeout: 10000,
    });

    const selfId = await extPage.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    const tab = await extPage.evaluate(
      async (id) => (await chrome.tabs.query({})).filter((t) => t.id !== id).at(-1).id,
      selfId
    );
    const states = await driveFromExtension(extPage, tab, 'apply', { semitones: 4, rate: 1 });
    await page.close();
    return { state: states.find((s) => s?.hasMedia), errors: errors.filter((e) => !e.includes('favicon')) };
  }

  // Real sites ship a strict script-src; the worklet module and the WASM both
  // have to survive it. This fixture mirrors youtube.com's own policy.
  test("works on a page with youtube.com's Content-Security-Policy", async () => {
    const { state, errors } = await shiftPageAt('/strict');
    assert.ok(state, 'no frame reported media');
    assert.equal(state.error, null, 'a YouTube-like CSP must not block the worklet');
    assert.equal(state.active, true);
    assert.ok(state.latencyMs > 0);
    assert.deepEqual(errors, []);
  });

  // No page realm can run WebAssembly when the CSP forbids it, so the only
  // correct behaviour is to say so promptly and leave the audio untouched.
  test('fails fast with a clear message when a CSP forbids WebAssembly', async () => {
    const { state } = await shiftPageAt('/nowasm');
    assert.ok(state, 'no frame reported media');
    assert.equal(state.ok, false);
    assert.match(state.error, /security policy/i);
    assert.equal(state.active, false, 'the audio must be left on the direct path');
  });
});
