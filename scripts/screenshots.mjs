#!/usr/bin/env node
/**
 * Renders the store screenshots into dist/store at exactly 1280x800, the size
 * both stores accept.
 *
 * Nothing here is a mockup: the panel in the picture is the real popup, driven
 * by the real content script against a real playing <audio>, so the status line
 * and the latency figure are measured rather than typed in. The only thing
 * patched is which tab the popup points at — opened in a tab of its own it
 * would otherwise target itself instead of the page behind it.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchWithExtension, extensionId } from '../tests/lib/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/store');
const WIDTH = 1280;
const HEIGHT = 800;

/**
 * `activeTab` is granted only on a real toolbar click, which this script cannot
 * perform, so the copy it loads gets an explicit host permission for the local
 * fixture origin instead. Nothing else about the build is changed, and the
 * uploaded package is the unmodified one from `npm run package`.
 */
async function stage(origin) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'transposeur-stage-'));
  await fs.cp(path.join(root, 'dist/chrome'), tmp, { recursive: true });
  const file = path.join(tmp, 'manifest.json');
  const mf = JSON.parse(await fs.readFile(file, 'utf8'));
  mf.host_permissions = [`${origin}/*`];
  await fs.writeFile(file, JSON.stringify(mf, null, 2));
  return tmp;
}

/** Makes the popup act on the demo tab rather than on the tab it lives in. */
const POINT_AT_DEMO = `
  const query = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (info) => {
    const all = await query({});
    const demo = all.find((t) => (t.url || '').includes('/store/demo.html'));
    return demo ? [demo] : query(info);
  };
`;

async function shoot({ lang, semitones, rate, file }) {
  const server = await startServer();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'transposeur-shot-'));
  const staged = await stage(server.origin);
  const context = await launchWithExtension(staged, profile, [
    `--lang=${lang}`,
    `--window-size=${WIDTH},${HEIGHT}`,
  ]);
  try {
    const id = await extensionId(context, 'Transposeur');

    const demo = await context.newPage();
    await demo.setViewportSize({ width: WIDTH, height: HEIGHT });
    await demo.goto(`${server.origin}/store/demo.html?lang=${lang.slice(0, 2)}`);
    await demo.waitForFunction(() => document.getElementById('a').currentTime > 0.4);

    const popup = await context.newPage();
    await popup.addInitScript(POINT_AT_DEMO);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await demo.bringToFront(); // a backgrounded tab gets throttled in headless
    await popup.waitForFunction(() => document.getElementById('status').textContent.length > 0);

    await popup.evaluate(
      ([st, rt]) => {
        for (const [idName, value] of [
          ['pitch', st],
          ['rate', rt],
        ]) {
          const el = document.getElementById(idName);
          el.value = String(value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      [semitones, Math.round(rate * 100)]
    );
    // The status line only reads "shifting" once the audio graph is live, so
    // waiting on it also proves the screenshot shows a working add-on.
    await popup
      .waitForFunction(() => /\d+\s*ms/.test(document.getElementById('status').textContent), {
        timeout: 20000,
      })
      .catch(async () => {
        const said = await popup.evaluate(() => document.getElementById('status').textContent);
        throw new Error(`the popup never reported a live audio graph; it said: ${said}`);
      });
    await popup.waitForTimeout(300);

    // Shoot <body>, which is exactly as wide as the popup: the viewport around
    // it is the tab's, not the panel's, so clipping to it would be wrong.
    const body = popup.locator('body');
    const size = await body.boundingBox();
    const panel = await body.screenshot();

    // Paste the captured panel back onto the page, where a popup would sit.
    await demo.evaluate(({ src, width }) => {
      const img = document.createElement('img');
      img.src = src;
      Object.assign(img.style, {
        position: 'fixed',
        top: '22px',
        right: '26px',
        width: `${width}px`,
        borderRadius: '10px',
        boxShadow: '0 18px 48px rgba(0,0,0,.55)',
        zIndex: '9',
      });
      document.body.appendChild(img);
      return new Promise((r) => (img.complete ? r() : (img.onload = r)));
    }, { src: `data:image/png;base64,${panel.toString('base64')}`, width: size.width });

    await fs.mkdir(out, { recursive: true });
    const file1280 = path.join(out, file);
    await demo.screenshot({ path: file1280 });
    console.log(`${path.relative(root, file1280)}  ${WIDTH}x${HEIGHT}`);
  } finally {
    await context.close();
    await server.close();
    await fs.rm(profile, { recursive: true, force: true });
    await fs.rm(staged, { recursive: true, force: true });
  }
}

await shoot({ lang: 'en-US', semitones: -3, rate: 0.85, file: 'screenshot-en.png' });
await shoot({ lang: 'fr', semitones: 3, rate: 1, file: 'screenshot-fr.png' });
