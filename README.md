# Longbox — Comic Reader

A personal, offline-first CBZ comic reader designed for comfortable reading on phones and tablets.

## Features

- Import and read `.cbz`, `.zip`, `.cbt`, and `.tar` comics locally on your device.
- **Page** mode for one-page-at-a-time reading.
- **Spread** mode for two-page landscape reading.
- **Scroll** mode for continuous horizontal reading.
- **Manga** mode for continuous right-to-left reading.
- **Webcomic** mode for continuous vertical reading.
- Pinch to zoom and drag to pan.
- **Frame Zoom** in Page mode: tap a detected panel to focus it, then double-tap to return.
- **Bubble Zoom**: double-tap a detected speech bubble to enlarge the bubble itself.
- Hold a bubble for the alternate bubble-zoom behavior; hold again to return.
- Bubble zoom stays anchored to the page and keeps the enlarged bubble inside the page bounds.
- Animated focus and bubble zoom transitions.
- Automatic control-bar hiding while reading, with controls returning when appropriate.
- Dark, sepia, and light reading themes.
- Bookmarks and reading progress.
- Installable as a PWA.
- Comic data is stored locally in the browser/device.

## Supported comic archives

Longbox imports CBZ, ZIP, CBT, TAR, CB7, 7Z, CBR, and RAR archives. 7Z/RAR extraction uses a lazily loaded browser archive engine; this build uses Filing's libarchive-based WebAssembly browser API through a browser-ready ESM loader.

## Library Search

The main library includes a local search field for titles, filenames, series information, and issue numbers.

## Continue Reading

The library shows the most recently opened unfinished comic with a direct button to resume at its saved page.

## Series / Issue Navigation

When a comic has detected series information and more than one issue is available, the reader header shows compact previous/next issue controls. Issues are ordered by detected issue number.

## Reading controls

Open the `?` button inside the reader for the current Reader Guide.

The important gestures are:

- **Swipe** — navigate according to the selected reading mode.
- **Pinch** — zoom the full page.
- **Drag** — pan while zoomed.
- **Page mode only:** tap a panel to focus that frame.
- **Double-tap a focused frame** — return to the full page.
- **Double-tap a bubble** — Bubble Zoom.
- **Hold a bubble** — alternate bubble zoom.
- **Hold again** — return from the bubble zoom.
- **Tap the center** — show or hide the reader controls.

## Offline storage

Longbox keeps imported comic data in browser storage on the device. The app shell is cached by the service worker so the reader can continue to launch offline.

Clearing the browser/site data can remove locally stored comics and reading data, so use the app's backup feature when appropriate.

## Diagnostics

The release keeps a hidden on-device diagnostic log for troubleshooting real-device gesture and detection issues.

To toggle it while reading:

1. Tap the comic title at the top **five times quickly**.
2. The diagnostic panel appears.
3. Repeat the five taps to hide it.

Diagnostics are off by default and do not change normal reader behavior unless enabled.

## Release candidate

**v56**

This build is based on the known-good v37 reader. It includes the library sort/PWA install UI and fixes the install prompt listener, uses a `.webmanifest` manifest with an explicit PWA identity, hides the install control when already installed, and provides sort-direction controls in the library and collection views, with responsive toolbar spacing for smaller screens.

## License

MIT License.

Copyright © 2026 bdredenbach.

The MIT license applies to the software in this repository. Comic artwork imported into the reader remains subject to its original copyright and licensing terms.


### Page transitions
Page mode uses a 3D page-turn transition when moving forward or backward. Other reading layouts remain unchanged.

### Page transitions
Page mode uses a book-like outgoing-page turn. Other reading layouts remain unchanged.


## v58 — StPageFlip viewport-fit experiment
Page mode only: StPageFlip is sized from the actual reader viewport and fills it. Spread, Scroll, Manga, and Webcomic remain on the existing renderer.


## v59 — StPageFlip direct Page-mode experiment
Page mode is exclusively owned by StPageFlip. The normal page renderer and page swipe handler are disabled while the engine is active. The engine is sized from the live reader viewport before initialization.
