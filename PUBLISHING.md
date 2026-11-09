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
- [ ] **Pick a less generic name.** "Pitch Shifter" is likely taken and reads as a category, not a
      product. Something like "Transpose" or a name of your own would fare better in both review and
      search. It appears in `extension/manifest.json`.
- [ ] **Localised store listings.** The add-on itself is English and French; the manifest
      description comes from `extension/_locales/*/messages.json` automatically. Both stores keep
      store *listings* separately, so add a French listing in each dashboard too, or French users
      see the English blurb.
- [ ] **Write the store description** — what it does, and the honest limits (the ~120 ms delay, no
      DRM sites). Both stores reject descriptions that oversell.
- [ ] **Screenshots.** At minimum the popup over a YouTube page. Chrome wants 1280×800 or 640×400.
- [ ] **Permission justifications.** Chrome asks for one per permission:
      - `activeTab` + `scripting` — inject the audio processing into the tab the user is on, only
        when they click the toolbar button.
      - `storage` — remember the last pitch and tempo between sessions.
      - No host permissions are requested, which is worth saying explicitly; it helps review.
- [ ] **Data disclosure: none.** Audio is processed in the page and nothing is transmitted. Firefox
      declares this already via `data_collection_permissions: { required: ['none'] }` in the built
      manifest; Chrome has an equivalent form in the dashboard.

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
