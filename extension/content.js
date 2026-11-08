/**
 * Injected on demand (popup click => scripting.executeScript) into every frame.
 * Idempotent: re-injection re-uses the existing instance.
 *
 * Exposes window.__pitchShifter for the popup to drive via executeScript, so we
 * need no messaging and no persistent background page.
 */
(() => {
  if (window.__pitchShifter) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const MODULE_URL = api.runtime.getURL('vendor/SignalsmithStretch.mjs');
  const CONFIG_URL = api.runtime.getURL('shifter-config.js');
  const config = import(CONFIG_URL); // DSP settings shared with the test suite
  const BUILD_TIMEOUT_MS = 8000;

  /** Elements we have already tapped. createMediaElementSource throws on a repeat. */
  const sources = new WeakMap();
  /** @type {{el: HTMLMediaElement, ctx: AudioContext, source: AudioNode, stretch: any}|null} */
  let graph = null;
  let building = null;
  let buildingFor = null;
  let settings = { semitones: 0, rate: 1 };
  let lastError = null;

  /** Visible, longest media element in this frame — the one the user is watching. */
  function pickMedia() {
    const all = [...document.querySelectorAll('video, audio')].filter(
      (el) => el.readyState > 0 || el.currentSrc || el.src
    );
    if (!all.length) return null;
    const scored = all.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, score: (el.paused ? 0 : 1e6) + r.width * r.height + (el.duration || 0) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].el;
  }

  const timeout = (promise, ms, what) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
    ]);

  async function build(el) {
    // An element can only ever be handed to one AudioContext, so the context is
    // created once per element and every retry happens inside it.
    const ctx = new AudioContext();
    let source = sources.get(el);
    if (!source) {
      source = ctx.createMediaElementSource(el);
      sources.set(el, source);
    }

    const { default: SignalsmithStretch } = await import(MODULE_URL);

    // The library would load the worklet from a blob: URL, which some pages'
    // CSPs refuse. Registering the packaged module from the extension origin
    // first is accepted more widely; if that is blocked too, the library's own
    // blob: path still gets its turn when the node is constructed.
    try {
      await ctx.audioWorklet.addModule(MODULE_URL);
    } catch {}

    const stretch = await timeout(
      SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }),
      BUILD_TIMEOUT_MS,
      'loading the audio engine'
    );
    stretch.connect(ctx.destination);
    stretch.start();
    // latency() is a round-trip to the worklet and is fixed for a given
    // configuration, so it is read once here rather than on every state query
    const latencySec = await timeout(stretch.latency(), BUILD_TIMEOUT_MS, 'the audio engine');
    return { el, ctx, source, stretch, latencySec, routed: null };
  }

  /**
   * Pitch comes from the WASM shifter; tempo comes from the media element's own
   * time-stretch (preservesPitch), which keeps audio and video in step.
   */
  function route(g, active) {
    if (g.routed === active) return;
    try {
      g.source.disconnect();
    } catch {}
    g.source.connect(active ? g.stretch : g.ctx.destination);
    g.routed = active;
  }

  function applyTempo(el, rate) {
    el.preservesPitch = true;
    el.mozPreservesPitch = true; // older Firefox
    if (el.playbackRate !== rate) el.playbackRate = rate;
  }

  async function apply({ semitones, rate }) {
    const { MAX_SEMITONES, MIN_RATE, MAX_RATE, shiftParams } = await config;
    if (typeof semitones === 'number') settings.semitones = clamp(semitones, -MAX_SEMITONES, MAX_SEMITONES);
    if (typeof rate === 'number') settings.rate = clamp(rate, MIN_RATE, MAX_RATE);
    lastError = null;

    const el = graph?.el?.isConnected ? graph.el : pickMedia();
    if (!el) return state();

    applyTempo(el, settings.rate);

    const needsShifter = settings.semitones !== 0;
    if (!needsShifter && !graph) return state(); // stay out of the audio path entirely

    try {
      if (!graph || graph.el !== el) {
        if (buildingFor !== el) {
          buildingFor = el;
          building = build(el).catch((e) => {
            buildingFor = null; // let the next click retry
            throw e;
          });
        }
        graph = await building;
      }
      if (graph.ctx.state === 'suspended') await graph.ctx.resume();
      route(graph, needsShifter);
      graph.stretch.schedule(shiftParams(settings.semitones));
    } catch (e) {
      // Most likely cause is a page CSP that blocks WebAssembly outright, which
      // cannot be worked around from the page's own realm.
      lastError = /timed out/.test(e?.message)
        ? api.i18n.getMessage('errorBlockedByCsp')
        : String(e?.message || e);
      if (graph) route(graph, false); // never leave the page silent
    }
    return state();
  }

  function state() {
    return {
      ok: !lastError,
      error: lastError,
      semitones: settings.semitones,
      rate: settings.rate,
      hasMedia: !!(graph?.el?.isConnected || pickMedia()),
      active: !!graph?.routed,
      latencyMs: graph ? Math.round(graph.latencySec * 1000) : 0,
      contextState: graph?.ctx?.state ?? null,
      href: location.href,
    };
  }

  async function reset() {
    const el = graph?.el || pickMedia();
    if (el) applyTempo(el, 1);
    settings = { semitones: 0, rate: 1 };
    if (graph) route(graph, false);
    return state();
  }

  window.__pitchShifter = { apply, state, reset, MODULE_URL };
})();
