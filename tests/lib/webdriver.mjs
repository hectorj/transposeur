/**
 * A WebDriver client just big enough to test the Firefox build.
 *
 * Playwright cannot install MV3 add-ons in Firefox, but geckodriver can install
 * an unsigned one temporarily — so the Firefox tests go through WebDriver.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const GECKODRIVER = process.env.GECKODRIVER_BIN || 'geckodriver';
const FIREFOX = process.env.FIREFOX_BIN || undefined;

/** A fixed add-on UUID, so moz-extension:// URLs are predictable in the test. */
export const EXTENSION_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

class WebDriverError extends Error {}

export async function startGeckodriver() {
  const port = await freePort();
  const proc = spawn(GECKODRIVER, ['--port', String(port), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /** Browser stdout/stderr, which carries page console output (see prefs below). */
  const log = [];
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => log.push(chunk));
  }

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`${base}/status`);
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline) {
      proc.kill('SIGKILL');
      throw new Error(`geckodriver did not start:\n${log.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, log, kill: () => proc.kill('SIGKILL') };
}

export class FirefoxSession {
  #base;
  #id;

  constructor(base, id) {
    this.#base = base;
    this.#id = id;
  }

  /**
   * `prefs` here matter as much as the capabilities: autoplay has to be allowed
   * for a test to start media without a click, the add-on's UUID is pinned so
   * its pages can be addressed, and page console output is routed to stdout so
   * the harness can see errors Firefox would otherwise keep to itself.
   */
  static async create(base, extraPrefs = {}) {
    const capabilities = {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          ...(FIREFOX ? { binary: FIREFOX } : {}),
          args: ['-headless'],
          prefs: {
            'media.autoplay.default': 0,
            'media.autoplay.blocking_policy': 0,
            'media.volume_scale': '0.0',
            'extensions.webextensions.uuids': JSON.stringify({
              'pitch-shifter@local': EXTENSION_UUID,
            }),
            'xpinstall.signatures.required': false,
            'devtools.console.stdout.content': true,
            ...extraPrefs,
          },
        },
      },
    };
    const res = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities }),
    });
    const body = await res.json();
    if (!res.ok) throw new WebDriverError(`could not start Firefox: ${JSON.stringify(body)}`);
    const session = new FirefoxSession(base, body.value.sessionId);
    await session.setScriptTimeout(30000);
    return session;
  }

  async #send(method, path, body) {
    const res = await fetch(`${this.#base}/session/${this.#id}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new WebDriverError(`${method} ${path}: ${json?.value?.message ?? res.statusText}`);
    }
    return json.value;
  }

  setScriptTimeout(ms) {
    return this.#send('POST', '/timeouts', { script: ms });
  }

  /** Installs an unpacked add-on for this session only. */
  installAddon(dir) {
    return this.#send('POST', '/moz/addon/install', { path: dir, temporary: true });
  }

  navigate(url) {
    return this.#send('POST', '/url', { url });
  }

  execute(script, args = []) {
    return this.#send('POST', '/execute/sync', { script, args });
  }

  /** The script must call its final argument to finish. */
  executeAsync(script, args = []) {
    return this.#send('POST', '/execute/async', { script, args });
  }

  newTab() {
    return this.#send('POST', '/window/new', { type: 'tab' }).then((v) => v.handle);
  }

  handles() {
    return this.#send('GET', '/window/handles');
  }

  switchTo(handle) {
    return this.#send('POST', '/window', { handle });
  }

  /** Polls a predicate in the page, the way Playwright's waitForFunction does. */
  async waitFor(script, args = [], { timeout = 10000, message = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.execute(`return Boolean((function(){${script}}).apply(null, arguments))`, args)) {
        return;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  quit() {
    return this.#send('DELETE', '');
  }
}
