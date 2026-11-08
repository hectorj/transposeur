/**
 * Minimal signal generation + analysis used to verify the shifter's behaviour.
 * Deliberately dependency-free so the tests stay cheap to run.
 */

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));

/** Average log-magnitude spectrum over overlapping frames. */
export function logSpectrum(signal, { fftSize = 16384, frames = 8 } = {}) {
  const win = hann(fftSize);
  const acc = new Float64Array(fftSize);
  const hop = Math.max(1, Math.floor((signal.length - fftSize) / Math.max(1, frames - 1)));
  let used = 0;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    if (off + fftSize > signal.length) break;
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = signal[off + i] * win[i];
    fft(re, im);
    for (let i = 0; i < fftSize; i++) acc[i] += Math.log(Math.hypot(re[i], im[i]) + 1e-12);
    used++;
  }
  if (!used) throw new Error('signal too short for analysis');
  for (let i = 0; i < fftSize; i++) acc[i] /= used;
  return acc; // full symmetric log spectrum
}

/**
 * Spectral envelope by cepstral liftering: the smooth shape that carries the
 * formants, with the harmonic comb (the pitch) removed.
 */
export function spectralEnvelope(signal, sampleRate, { lifterMs = 2.0, fftSize = 16384, frames = 8 } = {}) {
  const logMag = logSpectrum(signal, { fftSize, frames });
  const re = Float64Array.from(logMag);
  const im = new Float64Array(fftSize);
  fft(re, im, true); // real cepstrum
  const cut = Math.round((lifterMs / 1000) * sampleRate);
  for (let i = cut; i <= fftSize - cut; i++) (re[i] = 0), (im[i] = 0);
  fft(re, im);
  return { envelope: re.subarray(0, fftSize / 2), binHz: sampleRate / fftSize };
}

/** Frequency of the largest envelope peak inside [loHz, hiHz], parabolically interpolated. */
export function envelopePeakHz(signal, sampleRate, loHz, hiHz, opts) {
  const { envelope, binHz } = spectralEnvelope(signal, sampleRate, opts);
  const lo = Math.max(1, Math.floor(loHz / binHz));
  const hi = Math.min(envelope.length - 2, Math.ceil(hiHz / binHz));
  let best = lo;
  for (let i = lo; i <= hi; i++) if (envelope[i] > envelope[best]) best = i;
  const [a, b, c] = [envelope[best - 1], envelope[best], envelope[best + 1]];
  const delta = (0.5 * (a - c)) / (a - 2 * b + c || 1e-12);
  return (best + delta) * binHz;
}

/** Fundamental via normalised autocorrelation — robust when a formant is louder than f0. */
export function fundamentalHz(signal, sampleRate, minHz = 50, maxHz = 1500) {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.ceil(sampleRate / minHz);
  const n = Math.min(signal.length, 1 << 15);
  const x = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;
  for (let i = 0; i < n; i++) x[i] = signal[i] - mean;

  const energy = (from, len) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += x[from + i] * x[from + i];
    return s;
  };
  const len = n - maxLag;
  const e0 = energy(0, len);
  const norms = new Float64Array(maxLag + 1);
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < len; i++) corr += x[i] * x[i + lag];
    norms[lag] = corr / (Math.sqrt(e0 * energy(lag, len)) + 1e-12);
    best = Math.max(best, norms[lag]);
  }
  // Prefer the shortest period that is nearly as good as the strongest one:
  // plain argmax happily locks onto 2x the true period (an octave down).
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (norms[lag] < best * 0.92) continue;
    // must be a local maximum, not the flank of a broader peak
    if (norms[lag] >= norms[lag - 1] && norms[lag] >= norms[Math.min(maxLag, lag + 1)]) {
      bestLag = lag;
      break;
    }
  }
  return { hz: sampleRate / bestLag, confidence: best };
}

/** Peak-magnitude frequency, for pure tones. */
export function dominantHz(signal, sampleRate, { fftSize = 16384 } = {}) {
  return envelopePeakHz(signal, sampleRate, 20, sampleRate / 2 - 20, { lifterMs: 1e9, fftSize, frames: 4 });
}

/** Smoothed amplitude envelope, one value per `hop` samples. */
export function amplitudeEnvelope(signal, hop = 256) {
  const out = [];
  for (let i = 0; i + hop <= signal.length; i += hop) {
    let s = 0;
    for (let k = 0; k < hop; k++) s += signal[i + k] * signal[i + k];
    out.push(Math.sqrt(s / hop));
  }
  return out;
}

/** [startSec, endSec] of the region above `ratio` of peak amplitude. */
export function activeRegion(signal, sampleRate, ratio = 0.25, hop = 256) {
  const env = amplitudeEnvelope(signal, hop);
  const peak = Math.max(...env);
  const thr = peak * ratio;
  const first = env.findIndex((v) => v >= thr);
  let last = -1;
  for (let i = env.length - 1; i >= 0; i--)
    if (env[i] >= thr) {
      last = i;
      break;
    }
  if (first < 0) return null;
  return [(first * hop) / sampleRate, ((last + 1) * hop) / sampleRate];
}

export const semitoneRatio = (s) => Math.pow(2, s / 12);

/**
 * A synthetic voice: a jittering, vibrato-ing glottal pulse train with a
 * spectral tilt, run through fixed formant resonances. Realistic enough that
 * the shifter's own pitch tracker behaves as it would on a real singer.
 *
 * `f0` may be a number or a function of time in seconds.
 */
export function voiceLike({
  f0 = 120,
  sampleRate = 48000,
  seconds = 2,
  formants = [],
  gate = null,
  vibratoCents = 0,
  vibratoHz = 5,
  jitterCents = 0,
  tiltHz = 400,
} = {}) {
  const n = Math.round(sampleRate * seconds);
  const f0At = typeof f0 === 'function' ? f0 : () => f0;
  const cents = (c) => Math.pow(2, c / 1200);

  const src = new Float64Array(n);
  let pos = 0;
  let rng = 12345;
  while (pos < n) {
    src[Math.round(pos)] = 1;
    const t = pos / sampleRate;
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    const jitter = jitterCents ? cents(((rng / 0x7fffffff) * 2 - 1) * jitterCents) : 1;
    const vib = vibratoCents ? cents(vibratoCents * Math.sin(2 * Math.PI * vibratoHz * t)) : 1;
    pos += sampleRate / (f0At(t) * vib * jitter);
  }

  // one-pole low-pass standing in for the glottal source's spectral tilt
  if (tiltHz) {
    const a = Math.exp((-2 * Math.PI * tiltHz) / sampleRate);
    let y = 0;
    for (let i = 0; i < n; i++) {
      y = (1 - a) * src[i] + a * y;
      src[i] = y;
    }
  }

  const out = new Float64Array(n);
  for (const { hz, q, gain = 1 } of formants) {
    const w0 = (2 * Math.PI * hz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    // RBJ band-pass, constant peak gain
    const b0 = alpha;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const x0 = src[i];
      const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      out[i] += gain * y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
  }
  if (gate) for (let i = 0; i < n; i++) out[i] *= gate(i / sampleRate);

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = peak ? 0.5 / peak : 1;
  return Float32Array.from(out, (v) => v * scale);
}

export function sine({ hz = 440, sampleRate = 48000, seconds = 2, gate = null } = {}) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] = 0.5 * Math.sin(2 * Math.PI * hz * t) * (gate ? gate(t) : 1);
  }
  return out;
}

/**
 * Magnitude-weighted spectral centroid over [loHz, hiHz] — "brightness".
 *
 * This is the number that makes a shifted voice sound like a chipmunk: a naive
 * shifter scales the whole spectrum, so the centroid scales with the pitch
 * ratio. A formant-preserving shifter leaves it where it was.
 */
export function spectralCentroidHz(signal, sampleRate, loHz = 150, hiHz = 5000, { fftSize = 16384, frames = 8 } = {}) {
  const win = hann(fftSize);
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(loHz / binHz));
  const hi = Math.min(fftSize / 2 - 1, Math.ceil(hiHz / binHz));
  const hop = Math.max(1, Math.floor((signal.length - fftSize) / Math.max(1, frames - 1)));
  let num = 0;
  let den = 0;
  let used = 0;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    if (off + fftSize > signal.length) break;
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = signal[off + i] * win[i];
    fft(re, im);
    for (let i = lo; i <= hi; i++) {
      const m = Math.hypot(re[i], im[i]);
      num += m * i * binHz;
      den += m;
    }
    used++;
  }
  if (!used) throw new Error('signal too short for analysis');
  return num / (den + 1e-12);
}
