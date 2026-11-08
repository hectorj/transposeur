/**
 * Per-tab pitch and tempo settings.
 *
 * One global setting is wrong here: two songs open in two tabs want two
 * transpositions, and a global bucket also means changing sliders on a silent
 * tab silently arms the *next* tab you visit.
 *
 * Stored in `storage.session`, so settings live as long as the browser does and
 * never touch disk. Tab ids are not reused within a session, so stale entries
 * from closed tabs are harmless and vanish on restart.
 */

export const DEFAULTS = { semitones: 0, rate: 1 };

const key = (tabId) => `tab:${tabId}`;

export const isDefault = (settings) =>
  settings.semitones === DEFAULTS.semitones && settings.rate === DEFAULTS.rate;

export async function load(api, tabId) {
  const stored = await api.storage.session.get(key(tabId));
  return { ...DEFAULTS, ...stored[key(tabId)] };
}

export async function save(api, tabId, settings) {
  await api.storage.session.set({ [key(tabId)]: settings });
}

export async function clear(api, tabId) {
  await api.storage.session.remove(key(tabId));
}
