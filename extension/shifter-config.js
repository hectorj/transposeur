/**
 * Single source of truth for the shifter's DSP settings, imported both by the
 * content script (via dynamic import) and by the test suite.
 */

/**
 * Rough fundamental the formant analysis assumes, in Hz.
 *
 * Signalsmith Stretch can instead pitch-track this (`formantBaseHz: 0`), which
 * measures marginally better on an isolated voice — but a fixed base behaves
 * predictably on a full mix, where a tracker has several pitches to choose
 * between. 150 Hz sits between a typical male and female sung fundamental.
 */
export const FORMANT_BASE_HZ = 150;

export const MAX_SEMITONES = 12;
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

/**
 * Keeping the formants put while the harmonics move is the whole point: a naive
 * shifter scales the spectral envelope along with the pitch, which is what
 * turns a transposed singer into a chipmunk.
 */
export function shiftParams(semitones) {
  return {
    semitones,
    formantCompensation: true,
    formantBaseHz: FORMANT_BASE_HZ,
    active: true,
  };
}
