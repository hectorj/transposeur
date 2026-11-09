import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, extensionId } from './lib/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'extension/_locales');

const readLocale = async (lang) =>
  JSON.parse(await fs.readFile(path.join(localesDir, lang, 'messages.json'), 'utf8'));

describe('message catalogues', () => {
  let locales;

  before(async () => {
    const langs = await fs.readdir(localesDir);
    locales = Object.fromEntries(await Promise.all(langs.map(async (l) => [l, await readLocale(l)])));
  });

  test('every locale defines exactly the same keys', () => {
    const [reference, ...rest] = Object.keys(locales);
    for (const lang of rest) {
      assert.deepEqual(
        Object.keys(locales[lang]).sort(),
        Object.keys(locales[reference]).sort(),
        `${lang} and ${reference} should define the same messages`
      );
    }
  });

  test('placeholders match across locales, so no substitution goes missing', () => {
    const placeholders = (entry) => (entry.message.match(/\$[A-Za-z0-9_]+\$/g) ?? []).sort();
    const [reference, ...rest] = Object.keys(locales);
    for (const lang of rest) {
      for (const key of Object.keys(locales[reference])) {
        assert.deepEqual(
          placeholders(locales[lang][key]),
          placeholders(locales[reference][key]),
          `${key} uses different placeholders in ${lang}`
        );
      }
    }
  });

  test('every placeholder used in a message is declared', () => {
    for (const [lang, messages] of Object.entries(locales)) {
      for (const [key, entry] of Object.entries(messages)) {
        const used = (entry.message.match(/\$([A-Za-z0-9_]+)\$/g) ?? []).map((p) =>
          p.slice(1, -1).toLowerCase()
        );
        const declared = Object.keys(entry.placeholders ?? {}).map((p) => p.toLowerCase());
        for (const name of used) {
          assert.ok(declared.includes(name), `${lang}/${key} uses $${name}$ but never declares it`);
        }
      }
    }
  });

  test('no message was left untranslated in French', async () => {
    const [en, fr] = [await readLocale('en'), await readLocale('fr')];
    // "Tempo" is genuinely the same word; everything else should differ.
    const shared = Object.keys(en).filter((k) => en[k].message === fr[k].message);
    assert.deepEqual(shared, ['tempoLabel']);
  });
});

describe('the popup in French', () => {
  let context;
  let userDataDir;
  let page;

  before(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pitch-shifter-fr-'));
    context = await launchWithExtension(path.join(root, 'dist/chrome'), userDataDir, ['--lang=fr']);
    const id = await extensionId(context, 'Transposeur');
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);
  });

  after(async () => {
    await context?.close();
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('labels and buttons are translated', async () => {
    assert.match(await page.textContent('.label'), /Hauteur \(demi-tons\)/);
    assert.equal(await page.textContent('#reset'), 'Réinitialiser');
    assert.equal(
      await page.getAttribute('.step[data-target="pitch"][data-delta="1"]', 'aria-label'),
      'Un demi-ton plus haut'
    );
  });

  // French counts anything below two as singular, English does not. Getting
  // this from Intl.PluralRules rather than hard-coding it is the whole point.
  test('intervals use French plural rules, not English ones', async () => {
    const readouts = {};
    for (const semitones of [1, 2, 3, 4, 5]) {
      await page.evaluate((value) => {
        const el = document.getElementById('pitch');
        el.value = String(value);
        el.dispatchEvent(new Event('input'));
      }, semitones);
      readouts[semitones] = await page.textContent('#pitchVal');
    }
    assert.deepEqual(readouts, {
      1: '+1 (½ ton)',
      2: '+2 (1 ton)',
      3: '+3 (1½ ton)', // English would say "1½ tones"
      4: '+4 (2 tons)',
      5: '+5 (2½ tons)',
    });
  });
});
