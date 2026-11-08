import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { wav } from './wav.mjs';
import { voiceLike } from './dsp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wav': 'audio/wav',
};

/**
 * Serves tests/fixtures at / and the extension's vendored module at /vendor,
 * so the page loads the exact artifact the extension ships.
 */
/**
 * `strict` mirrors youtube.com's actual policy as of 2026-11: scripts are
 * restricted but 'unsafe-eval' is present, so WebAssembly is allowed and no
 * worker-src/default-src constrains where a worklet module may come from.
 * `nowasm` is harsher than any real site and blocks WebAssembly itself.
 */
const CSPS = {
  strict: "script-src 'unsafe-eval' 'self' 'unsafe-inline'; object-src 'none'; media-src 'self'",
  nowasm: "default-src 'self'; script-src 'self'; media-src 'self'; worker-src 'none'",
};

let toneCache = null;

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/tone.wav') {
      // a sung-vowel-like tone, generated once, so the fixture needs no binary asset
      toneCache ??= wav(
        voiceLike({
          f0: 150,
          seconds: 4,
          vibratoCents: 30,
          formants: [
            { hz: 700, q: 8, gain: 1 },
            { hz: 1150, q: 10, gain: 0.55 },
          ],
        })
      );
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': toneCache.length });
      res.end(toneCache);
      return;
    }
    // Prefixed paths serve the same fixtures behind a CSP, so the tests can
    // check both a realistic locked-down page and a hostile one.
    const csp = Object.keys(CSPS).find((p) => url.pathname.startsWith(`/${p}/`));
    const rel =
      url.pathname === '/' ? '/harness.html' : csp ? url.pathname.slice(csp.length + 1) : url.pathname;
    const file = rel.startsWith('/vendor/')
      ? path.join(root, 'extension', rel)
      : path.join(root, 'tests/fixtures', rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await fs.readFile(file);
      const headers = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
      if (csp) headers['content-security-policy'] = CSPS[csp];
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const CHROMIUM = process.env.CHROMIUM_BIN || undefined;

export function launchArgs(extra = []) {
  return [
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...extra,
  ];
}

export async function launchBrowser(extra = []) {
  return chromium.launch({ executablePath: CHROMIUM, args: launchArgs(extra) });
}

/**
 * Extensions only load in a persistent context with a visible-ish browser, so
 * the new headless mode is requested explicitly via --headless=new.
 */
export async function launchWithExtension(extensionDir, userDataDir) {
  return chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROMIUM,
    args: launchArgs([
      '--headless=new',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ]),
  });
}

/** Collects page console errors / failed requests for CSP regressions. */
export function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
