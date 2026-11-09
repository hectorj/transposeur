# Publishing

```sh
npm run build && npm run package
```

produces, in `dist/`:

| File | For |
| --- | --- |
| `pitch-shifter-chrome-<v>.zip` | Chrome Web Store upload |
| `pitch-shifter-firefox-<v>.zip` | addons.mozilla.org upload |
| `pitch-shifter-source-<v>.zip` | AMO's required source archive (see below) |

## Decide the goal first

**If this is just for your teacher**, a full public listing is a lot of overhead for one user —
review cycles, store metadata, and an ongoing maintenance obligation. Two lighter routes give a
permanent, no-nagging install:

- **Firefox — unlisted signed add-on.** AMO will sign an add-on without listing it publicly. You get
  a signed `.xpi` that installs permanently in release Firefox and auto-updates if you host an
  update manifest. Free, and review for unlisted add-ons is usually automated. This is the best fit.
- **Chrome — unlisted Web Store item.** Chrome has no equivalent to unlisted signing; anything that
  installs permanently has to come from the Web Store. "Unlisted" means it is not searchable but
  anyone with the link can install. Still needs the developer account and still goes through review.

Loading unpacked (what you are doing now) works but Chrome nags about developer mode on every start,
and Firefox drops temporary add-ons on restart. Neither is good for a non-technical user.

Go fully public later, once your teacher has used it for a few weeks and you know it holds up.

## What only you can do

I cannot create accounts, accept terms, pay fees, or submit on your behalf.

- **Chrome Web Store** — one-time **$5 USD** developer registration fee, plus identity verification.
  Review typically takes a few days; extensions touching page content sometimes take longer.
- **AMO** — free. Create an account, then either upload through the site or use `web-ext sign`.

## Before the first submission

- [ ] **Confirm the add-on id.** `scripts/build.mjs` sets `GECKO_ID`. It identifies *this* add-on,
      not you — AMO ties an id to exactly one listing, so anything else you publish later needs its
      own. Hence the add-on's name in the local part and a domain you control as the namespace. It
      is permanent from the first signing, is publicly visible, and is never used for contact; it
      need not be an email at all (a GUID is equally valid).
- [x] **Name checked.** **Transposeur** was free on AMO as of 2026-11-09. It lives in
      `extension/manifest.json` and is deliberately not translated — it is the brand in both
      languages.
- [x] **Add-on id settled.** `transposeur@hectorj.net`.
- [ ] **Localised store listings.** The add-on itself is English and French; the manifest
      description comes from `extension/_locales/*/messages.json` automatically. Both stores keep
      store *listings* separately, so add a French listing in each dashboard too, or French users
      see the English blurb.
- [ ] **Paste the store copy** from "Store listing copy" below. Both stores reject descriptions
      that oversell, so the limits are stated rather than buried.
- [ ] **Screenshots.** At minimum the popup over a YouTube page. Chrome wants 1280×800 or 640×400.
- [ ] **Permission justifications.** Chrome asks for one per permission:
      - `activeTab` + `scripting` — inject the audio processing into the tab the user is on, only
        when they click the toolbar button.
      - `storage` — remember the last pitch and tempo between sessions.
      - No host permissions are requested, which is worth saying explicitly; it helps review.
- [ ] **Data disclosure: none.** Audio is processed in the page and nothing is transmitted. Firefox
      declares this already via `data_collection_permissions: { required: ['none'] }` in the built
      manifest; Chrome has an equivalent form in the dashboard.

## Store listing copy

Ready to paste. Keep the limits in: both stores take a dim view of a description that only sells,
and a teacher who discovers the delay on their own will trust the rest of it less.

Suggested category: **Audio/Video**. Licence: **MIT**. Privacy policy: not required — no data is
collected, and the Firefox manifest already declares that.

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

## The AMO source-code requirement

AMO requires a source archive whenever an add-on contains code that is generated, compiled or
minified, because reviewers have to be able to read what they are approving. This add-on ships
`vendor/SignalsmithStretch.mjs` — an emscripten build with the WASM embedded as base64 — so the
requirement applies. `npm run package` produces the archive; in the AMO form, give build
instructions along these lines:

> The vendored file `extension/vendor/SignalsmithStretch.mjs` is the official prebuilt WASM release
> of Signalsmith Stretch (MIT), taken unmodified from the upstream repository at the commit recorded
> in `third_party/signalsmith-stretch/VENDORED_COMMIT`. To rebuild it from C++ sources:
> `nix develop .#wasm`, then run `web/emscripten/compile.sh` from that upstream checkout.
> Everything else in the add-on is plain, unminified JavaScript; `npm run build` copies
> `extension/` to `dist/firefox/` and patches only the manifest.

Keep `third_party/signalsmith-stretch/LICENSE.txt` in the package — the MIT licence requires the
copyright notice to travel with the code, and reviewers check.

## Signing an unlisted Firefox build

Get API credentials from the AMO developer hub, then:

```sh
export WEB_EXT_API_KEY=user:...
export WEB_EXT_API_SECRET=...
npm run build
web-ext sign -s dist/firefox --channel=unlisted --artifacts-dir=dist
```

The signed `.xpi` lands in `dist/` and installs in release Firefox by opening the file. Keep the
credentials out of the repo — environment only.

## Releasing an update

1. Bump `version` in `extension/manifest.json` — both stores reject a re-used version.
2. `npm test` — all suites green.
3. `npm run build && npm run package`.
4. Upload. For AMO, attach the new source archive too.
