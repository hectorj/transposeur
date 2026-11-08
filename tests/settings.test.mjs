import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, isDefault, load, save, clear } from '../extension/settings.js';

/** Stand-in for chrome.storage.session, which is a flat key/value store. */
function fakeApi() {
  const data = new Map();
  return {
    data,
    storage: {
      session: {
        async get(key) {
          return data.has(key) ? { [key]: data.get(key) } : {};
        },
        async set(entries) {
          for (const [k, v] of Object.entries(entries)) data.set(k, v);
        },
        async remove(key) {
          data.delete(key);
        },
      },
    },
  };
}

let api;
beforeEach(() => {
  api = fakeApi();
});

describe('per-tab settings', () => {
  test('a tab with nothing stored gets the defaults', async () => {
    assert.deepEqual(await load(api, 1), DEFAULTS);
  });

  // The bug this replaced: one global bucket meant changing the sliders on a
  // silent tab armed whichever tab you looked at next.
  test('two tabs keep entirely separate settings', async () => {
    await save(api, 1, { semitones: 3, rate: 0.75 });
    await save(api, 2, { semitones: -5, rate: 1 });

    assert.deepEqual(await load(api, 1), { semitones: 3, rate: 0.75 });
    assert.deepEqual(await load(api, 2), { semitones: -5, rate: 1 });
    assert.deepEqual(await load(api, 3), DEFAULTS, 'an untouched tab stays at the defaults');
  });

  test('clearing one tab leaves the others alone', async () => {
    await save(api, 1, { semitones: 3, rate: 0.75 });
    await save(api, 2, { semitones: 7, rate: 1 });
    await clear(api, 1);

    assert.deepEqual(await load(api, 1), DEFAULTS);
    assert.deepEqual(await load(api, 2), { semitones: 7, rate: 1 });
  });

  test('a partially stored entry still fills in the missing half', async () => {
    api.data.set('tab:1', { semitones: 4 });
    assert.deepEqual(await load(api, 1), { semitones: 4, rate: 1 });
  });

  test('settings are namespaced per tab id', async () => {
    await save(api, 42, { semitones: 1, rate: 1 });
    assert.deepEqual([...api.data.keys()], ['tab:42']);
  });

  test('isDefault recognises an untouched tab', () => {
    assert.equal(isDefault(DEFAULTS), true);
    assert.equal(isDefault({ semitones: 0, rate: 1 }), true);
    assert.equal(isDefault({ semitones: 1, rate: 1 }), false);
    assert.equal(isDefault({ semitones: 0, rate: 0.9 }), false);
  });
});
