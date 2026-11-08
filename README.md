# pitch-shifter

Transpose and slow down any audio or video in a web page — in **Chrome and Firefox** — without
turning the singer into a chipmunk.

Built for a singing teacher who needs to move a song into a student's range mid-lesson.

## Why the chipmunk effect happens, and what this does instead

A naive pitch shifter scales the whole spectrum. That moves the **formants** — the vocal-tract
resonances that tell your ear how big the singer's head is — along with the pitch, so a transposed
voice sounds like a smaller creature. This extension shifts the harmonics while holding the formants
where they were, which is what keeps the voice sounding like a person.

The DSP is [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) (MIT),
running as WASM in an AudioWorklet. Vendored commit in
[`third_party/signalsmith-stretch/`](third_party/signalsmith-stretch/).

Tempo is handled separately, by the media element's own `preservesPitch` time-stretch, so **audio
and video stay in step** when you slow a passage down. Pitch and tempo are therefore fully
independent.

## Install

```sh
nix develop          # toolchain: node, chromium, web-ext
npm install
npm run build        # -> dist/chrome, dist/firefox
```

- **Chrome**: `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chrome`
- **Firefox**: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `dist/firefox/manifest.json`

Click the toolbar icon, drag the two sliders. Pitch is in semitones (±12), tempo in percent
(50–150%). *Reset* returns both to normal and takes the shifter out of the audio path entirely.

## How it works

Nothing runs until you open the popup. The popup then injects
[`content.js`](extension/content.js) into the active tab (`activeTab` + `scripting`, so there is no
broad host permission and no background page), which:

1. picks the most likely media element in each frame;
2. taps it with `createMediaElementSource` and routes it through the WASM shifter;
3. sets `playbackRate` / `preservesPitch` on the element for tempo;
4. bypasses itself — source straight to output — whenever pitch is back at 0.

Audio never leaves the machine.

## Testing

```sh
npm test              # everything
npm run test:dsp      # DSP behaviour, via the real WASM worklet
npm run test:extension # the packed extension in headless Chromium
npm run lint:firefox  # web-ext lint of the Firefox build
```

`test:dsp` renders synthetic signals through the actual shipped worklet in an `OfflineAudioContext`,
so it is deterministic and needs no audio hardware. It asserts, among other things:

- a 440 Hz tone lands within 15 cents of the target for shifts of ±12 semitones;
- a synthetic voice (vibrato, jitter, three fixed formants) keeps its **spectral centroid** within
  10% when shifted ±5 semitones, while the pitch moves the full amount — and that a naive shift
  under the same conditions drifts at least twice as far. That centroid drift *is* the chipmunk
  effect, measured.
- a 1-second burst is still 1 second long after a shift (the pitch shifter must not change tempo).

`test:extension` loads the built extension into Chromium, plays a real media element, drives the
content script through `chrome.scripting` exactly as the popup does, and checks the graph is built,
the page is never left silent or stalled, and nothing trips the page's CSP.

## Known limits

| Limit | Detail |
| --- | --- |
| ~120 ms audio delay | The shifter needs lookahead. Fine for practice; noticeable against close-up lip sync. Only applies while pitch ≠ 0. |
| DRM sites | Web Audio cannot tap EME-protected media (Netflix, Spotify web). YouTube is fine. |
| Hostile CSP | A page whose CSP forbids WebAssembly cannot be shifted from its own realm. The popup says so instead of hanging; there is a test for it. YouTube's real CSP allows it. |
| Firefox ≥ 142 | Required by the `data_collection_permissions` manifest key. |
| Firefox verification | The Firefox build passes `web-ext lint` with 0 errors, but the audio path has not been run in a real Firefox — Playwright cannot load MV3 extensions there. Worth a manual pass before handing it over. |

## System-wide audio (not built)

For shifting *all* of Windows' output rather than a browser tab, the quickest route needs no code:
[Equalizer APO](https://sourceforge.net/projects/equalizerapo/) plus a formant-aware pitch VST
(Graillon 2 Free, MAutoPitch) in the system chain. A proper virtual-audio-device app could reuse
this same DSP core natively; `nix develop .#wasm` has the emscripten toolchain for rebuilding it
from the C++ sources.

## Licence

MIT, matching the vendored DSP library.
