# Privacy policy

**Transposeur does not collect, store, transmit or share any personal data.**

Last updated: 2026-11-10.

## What the add-on does with your data

Nothing leaves your computer.

Transposeur reads the audio of the `<audio>` or `<video>` element already playing in the tab you
are on, and processes it in that page to change its pitch and speed. The processing happens entirely
inside your browser, in real time. The audio is never recorded, never buffered to disk and never
sent to any server — there is no server.

The add-on makes no network requests of any kind. Everything it runs, including its WebAssembly
audio engine, ships inside the add-on package.

## What is stored

The pitch and tempo you set for a tab are kept in `chrome.storage.session` (`browser.storage.session`
in Firefox), so that your settings survive a page reload. This storage is held in memory, is scoped
to the browser session, and is discarded when you close the browser. Nothing is written to disk and
nothing is synced to any account.

## What is not accessed

- No browsing history, no list of visited pages, no page content beyond the media element itself.
- No account, no sign-in, no identifier of any kind.
- No analytics, no telemetry, no crash reporting, no advertising.

The add-on requests no host permissions. It uses `activeTab`, which grants access only to the one
tab whose toolbar button you clicked, and only for that visit.

## Third parties

There are none. No data is sold, transferred or disclosed to anyone, because none is collected.

## Source code

Transposeur is open source under the MIT licence. Everything described above can be verified in the
source: <https://github.com/hectorj/transposeur>

## Contact

Questions or concerns: <https://github.com/hectorj/transposeur/issues>
