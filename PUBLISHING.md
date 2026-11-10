# Publishing

```sh
nix develop --command npm run package
```

produces, in `dist/` (names follow the manifest, so a rename carries through):

| File | For |
| --- | --- |
| `transposeur-chrome-<v>.zip` | Chrome Web Store upload |
| `transposeur-firefox-<v>.zip` | addons.mozilla.org upload |
| `transposeur-source-<v>.zip` | AMO's source archive (see "Notes to Reviewer") |

```sh
nix develop --command npm run screenshots
```

renders `dist/store/screenshot-{en,fr}.png` at 1280×800, the size both stores take. They are not
mockups: the panel in them is the real popup driven against a real playing `<audio>`, so the status
line and the latency figure are measured. Re-render them whenever the popup changes.

## Where things stand

- **Firefox — submitted as a public listing**, 2026-11-10, awaiting review:
  <https://addons.mozilla.org/en-US/firefox/addon/transposeur/>. The French store listing is still
  to be added from the dashboard; that needs no new version and no new review.
- **Chrome — not started.** See "Chrome Web Store, step by step" below. Chrome has no equivalent to
  AMO's unlisted *signing*: anything that installs permanently has to come from the Web Store, so
  the $5 developer account is unavoidable even for a private add-on. Unlisted is the sensible
  setting — not searchable, installable by link.

Loading unpacked works for development but Chrome nags about developer mode on every start, and
Firefox drops temporary add-ons on restart. Neither is good for a non-technical user.

## What only you can do

I cannot create accounts, accept terms, pay fees, or submit on your behalf.

- **Chrome Web Store** — one-time **$5 USD** developer registration fee, plus identity verification.
  Review typically takes a few days; extensions touching page content sometimes take longer.
- **AMO** — free. Create an account, then either upload through the site or use `web-ext sign`.

## Before the first submission

- [x] **Add-on id settled:** `transposeur@hectorj.net`, in `scripts/build.mjs` as `GECKO_ID`. It
      identifies *this* add-on, not you — AMO ties an id to exactly one listing, so anything else
      published later needs its own. Permanent from the first signing, publicly visible, never used
      for contact.
- [x] **Name checked.** **Transposeur** was free on AMO as of 2026-11-09. It lives in
      `extension/manifest.json` and is deliberately not translated — it is the brand in both
      languages.
- [ ] **Localised store listings.** The add-on itself is English and French; the manifest
      description comes from `extension/_locales/*/messages.json` automatically. Both stores keep
      store *listings* separately, so add a French listing in each dashboard too, or French users
      see the English blurb.
- [ ] **Paste the store copy** from "Store listing copy" below. Both stores reject descriptions
      that oversell, so the limits are stated rather than buried.
- [x] **Screenshots.** `npm run screenshots` produces an English and a French one at 1280×800.
- [ ] **Permission justifications.** Chrome asks for one per permission; "Chrome Web Store, step by
      step" below has them written out to paste. In short:
      - `activeTab` + `scripting` — inject the audio processing into the tab the user is on, only
        when they click the toolbar button.
      - `storage` — remember each tab's pitch and tempo while the browser is open. Written to
        `storage.session`, which is in-memory and cleared on exit; nothing is persisted to disk.
      - No host permissions are requested, which is worth saying explicitly; it helps review.
- [ ] **Data disclosure: none.** Audio is processed in the page and nothing is transmitted. Firefox
      declares this already via `data_collection_permissions: { required: ['none'] }` in the built
      manifest; Chrome has an equivalent form in the dashboard.

## Store listing copy

Ready to paste. Keep the limits in: both stores take a dim view of a description that only sells,
and a teacher who discovers the delay on their own will trust the rest of it less.

AMO category: **Photos, Music & Videos**. Licence: **MIT**. Privacy policy: not required — no
data is collected, and the Firefox manifest already declares that.

### English — summary (AMO allows 250 characters)

> Transpose any song in your browser without the chipmunk effect. Shift the pitch in semitones and
> slow the tempo down separately, to practise and sing along in your own range.

### English — description

> Transposeur moves a song into your range while it plays, in any tab.
>
> Most pitch shifters scale the whole spectrum, which moves the formants — the vocal-tract
> resonances that tell your ear how big a singer is — and makes a transposed voice sound like a
> chipmunk. Transposeur shifts the harmonics but holds the formants where they were, so the voice
> still sounds like a person.
>
> - Pitch in semitones, up or down an octave.
> - Tempo from 50% to 150%, independent of pitch, so you can slow a passage down without changing
>   its key. Audio and video stay in sync.
> - Each tab keeps its own settings.
> - Interface in English and French.
>
> Nothing leaves your computer: the audio is processed in the page, nothing is recorded, and no
> account is needed. The add-on asks for no permission to read your browsing — it only touches the
> tab you are on, and only once you click its button.
>
> Two honest limits: shifting the pitch delays the audio by about 120 ms, which is unnoticeable for
> practice but visible against a close-up of someone speaking; and it cannot work on DRM-protected
> services such as Netflix. YouTube works.

### French — summary

> Transposez n'importe quel morceau dans votre navigateur, sans effet Chipmunks. Changez la hauteur
> en demi-tons et ralentissez le tempo séparément, pour travailler et chanter dans votre tessiture.

### French — description

> Transposeur adapte un morceau à votre tessiture pendant la lecture, dans n'importe quel onglet.
>
> La plupart des transpositeurs décalent tout le spectre, donc aussi les formants — les résonances
> du conduit vocal qui indiquent à l'oreille la taille du chanteur. La voix transposée prend alors
> un timbre de Chipmunk. Transposeur décale les harmoniques mais laisse les formants en place : la
> voix continue de sonner humaine.
>
> - Hauteur en demi-tons, jusqu'à une octave vers le haut ou vers le bas.
> - Tempo de 50 % à 150 %, indépendant de la hauteur : ralentissez un passage sans en changer la
>   tonalité. L'audio et la vidéo restent synchronisés.
> - Chaque onglet conserve ses propres réglages.
> - Interface en français et en anglais.
>
> Rien ne quitte votre ordinateur : le son est traité dans la page, rien n'est enregistré et aucun
> compte n'est nécessaire. L'extension ne demande aucune permission de lecture de votre navigation ;
> elle n'agit que sur l'onglet affiché, et seulement après un clic sur son bouton.
>
> Deux limites, annoncées franchement : la transposition retarde le son d'environ 120 ms, ce qui est
> imperceptible pour travailler mais visible sur un gros plan de quelqu'un qui parle ; et elle ne
> peut rien faire sur les services protégés par DRM comme Netflix. YouTube fonctionne.

## Notes to Reviewer

AMO has one field for this, and it has to carry two things: why the validator's warnings are
benign, and how to rebuild the generated code. Paste the whole block.

> **About the two UNSAFE_VAR_ASSIGNMENT warnings**
>
> Both are the dynamic `import()` calls in `content.js`. Each loads a file packaged inside this
> add-on, addressed through `browser.runtime.getURL()` and declared in `web_accessible_resources`.
> The argument is never a remote URL and never derived from page content. A content script cannot
> be an ES module, so a dynamic import is the only way to load the WASM audio module and the shared
> settings module from the extension's own origin. Nothing is fetched at runtime from outside the
> package.
>
> **About the generated code**
>
> `vendor/SignalsmithStretch.mjs` is the official prebuilt WASM release of Signalsmith Stretch
> (MIT), used unmodified from the upstream repository at the commit recorded in
> `third_party/signalsmith-stretch/VENDORED_COMMIT`. Its licence travels with it in
> `third_party/signalsmith-stretch/LICENSE.txt`.
>
> To rebuild that file from its C++ sources, from an upstream checkout at that commit:
>
>     ./web/emscripten/compile.sh web/emscripten/main.cpp web/release/SignalsmithStretch.mjs SignalsmithStretch
>
> To rebuild this add-on from the attached source archive (requires Nix):
>
>     nix develop
>     npm install
>     npm run build        # produces dist/firefox
>
> The build is deterministic: `dist/firefox` comes out file-for-file identical to the contents of
> the uploaded package (the .zip container itself carries timestamps, so compare the files, not the
> archive).
>
> Everything else in the add-on is plain, unminified JavaScript. `npm run build` copies `extension/`
> to `dist/firefox/` and patches only the manifest, adding the Firefox add-on id and the
> data-collection declaration.
>
> **Testing it**
>
> No account or credentials are needed. Open any page with audio or video — youtube.com is the
> intended case — start playback, click the toolbar button, and move the Pitch slider off zero.
> Pitch is in semitones; Tempo is independent of it. The interface is English and French, following
> the browser language.

## Chrome Web Store, step by step

Firefox is published; this is the other half. Chrome has no unlisted-signing route, so even a
private add-on has to go through the Web Store, and that means the developer account.

**1. Register.** <https://chrome.google.com/webstore/devconsole>, sign in, pay the one-time **$5**
fee and complete identity verification. Verification can take a day or two on its own, and nothing
can be submitted until it clears — start it first and do the rest while it runs.

**2. Create the item** and upload `dist/transposeur-chrome-<v>.zip`. Chrome takes the Chrome build,
not the Firefox one: they differ, the Firefox zip carries the Gecko add-on id.

**3. Store listing.**

| Field | What to put |
| --- | --- |
| Name | Transposeur |
| Summary (132 chars) | the English summary from "Store listing copy" above, trimmed to fit |
| Description | the English description from "Store listing copy" above |
| Category | Entertainment |
| Language | English, then add French and paste the French copy |
| Icon | `extension/icons/icon-128.png` |
| Screenshots | `dist/store/screenshot-en.png`, and `screenshot-fr.png` under the French listing |
| Support URL | <https://github.com/hectorj/transposeur/issues> |

**4. Privacy practices.** The tab that trips people up. Answers:

- *Single purpose* — "Transposeur changes the musical pitch and the playback speed of the audio or
  video already playing in the tab the user is on, so that a singer can practise in their own range."
- *activeTab* — "The add-on processes the audio of the page the user is on. activeTab grants that
  access only for the tab whose toolbar button the user clicked, which is narrower than any host
  permission would be."
- *scripting* — "Used to inject the audio-processing content script into the active tab on demand,
  once the user opens the popup. Nothing is injected into tabs the user has not activated."
- *storage* — "Remembers each tab's pitch and tempo while the browser is open, so the settings
  survive a page reload. Written to storage.session, which is in-memory and discarded on exit;
  nothing is written to disk."
- *Host permissions* — none are requested. Say so; it shortens review.
- *Remote code* — **No, I am not using remote code.** Everything the add-on runs ships inside the
  package, including the WebAssembly module. Nothing is fetched or evaluated from a remote origin.
- *Data usage* — tick nothing. No data is collected, used or transferred; audio never leaves the
  page. Then certify compliance with the Developer Program Policies.

**5. Distribution.** **Unlisted** is the right choice for now: anyone with the link can install, it
does not appear in search, and it needs no audience. It can be flipped to Public later without
re-review of the listing. All regions, free, no in-app purchases.

**6. Submit.** Review is usually a few days. Extensions that touch page content sometimes take
longer, and the first submission from a new account is the slowest one.

Chrome has no "Notes to Reviewer" field, and no source-archive requirement — the AMO block above is
Firefox-only. If a reviewer does ask about the WebAssembly, the answer is the same: it is the
upstream prebuilt release of Signalsmith Stretch (MIT), vendored at the commit recorded in
`third_party/signalsmith-stretch/VENDORED_COMMIT`, and the sources are public at
<https://github.com/hectorj/transposeur>.

## Firefox for Android

**Not claimed as compatible, and not tested.** When submitting a version, leave *Firefox for
Android* unchecked unless it has actually been tried on a device.

What is known: the manifest declares nothing Android-incompatible — `web-ext lint` reports no
`KEY_FIREFOX_ANDROID_*` warnings at `strict_min_version: 142.0`, and it does check for them (at
140.0 it flagged `data_collection_permissions`).

What is unknown, and needs a real device:

- whether `createMediaElementSource`, the AudioWorklet and the WASM module behave as they do on
  desktop Gecko;
- whether the popup is usable — it is laid out at a fixed 268px, which suits a desktop panel, not a
  phone;
- how Android's media handling (backgrounding, picture-in-picture, the system player) interacts
  with an audio graph tapped off the media element.

To test, connect a phone over USB with debugging enabled and `adb` on PATH, then:

```sh
npm run run:android
```

If it works, enable Android compatibility on the *next* version rather than retrofitting the claim
onto one already published.

## The AMO source-code requirement

AMO requires a source archive whenever an add-on contains generated, compiled or minified code,
because reviewers have to be able to read what they are approving. This add-on ships
`vendor/SignalsmithStretch.mjs` — an emscripten build with the WASM embedded as base64 — so the
requirement applies. `npm run package` produces `transposeur-source-<v>.zip`; attach it, and paste
the build instructions from "Notes to Reviewer" above.

Keep `third_party/signalsmith-stretch/LICENSE.txt` in the package — the MIT licence requires the
copyright notice to travel with the code, and reviewers check.

`nix develop .#wasm` provides the emscripten toolchain, if the WASM module ever has to be rebuilt
from the C++ sources rather than taken from upstream.

## Signing an unlisted Firefox build

Get API credentials from the AMO developer hub and put them in `.env.local` (gitignored, and
`chmod 600`):

```sh
WEB_EXT_API_KEY=user:...
WEB_EXT_API_SECRET=...
```

Then:

```sh
nix develop --command npm run sign:firefox
```

That builds and signs through `scripts/with-env.sh`, which sources the file into the command's
environment — so the values never reach the shell history or the process list, and are never
printed. Do not `export` them on the command line instead.

The signed `.xpi` lands in `dist/` and installs in release Firefox by opening the file.

## Releasing an update

1. Bump `version` in `extension/manifest.json` — both stores reject a re-used version.
2. `npm test` — all suites green.
3. `nix develop --command npm run package`.
4. Upload. For AMO, attach the new source archive too.
