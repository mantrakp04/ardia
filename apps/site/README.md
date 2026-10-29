# Ardia site

The landing page. Astro, built to static files (`dist/`), deployable to GitHub Pages or Cloudflare Pages.

It's a standalone package: the repo's pnpm workspace excludes it (the root hoists `node_modules` for React
Native), so install it on its own.

```bash
cd apps/site
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # → dist/
pnpm preview    # serve dist/
```

`SITE_URL` sets the canonical/OG origin, `SITE_BASE` the path prefix (e.g. `SITE_BASE=/ardia` for GitHub
Pages without a custom domain).

## Updating

- **A release:** `.claude/skills/release/scripts/site-version.mjs <version>` writes `src/data/release.json` (the
  version and the DMG's size) from the published release. The download button links to
  `releases/download/v<version>/Ardia-<version>.dmg`.
- **Release notes:** `/release-notes` renders the repo's `docs/release-notes/<version>.md` (one file per version,
  `src/content.config.ts`), newest first, each at `/release-notes#<version>`. The app opens that anchor after it
  updates, so rebuild and redeploy the site when a release ships (`docs/releasing.md`).
- **Hero poster:** until WebGL draws its first frame, the hero shows a WebP of that exact frame (dawn, or
  morning with reduced motion) in five framings: `tall` (phones), `mid`, `laptop` (16:10), `wide` (16:9) and
  `wider`. `src/data/heroPoster.ts` holds the media queries; the canvas crossfades in over it. After changing
  the meadow's look or the hero text, run `pnpm dev` and `node scripts/hero-posters.mjs --url <dev url>`: it
  captures each frame in headless Chrome on the GPU, works out the text tones the scene picks, and rewrites
  `src/assets/hero/`.
- **Screenshots:** `src/assets/shots/*.webp` are real window captures of Ardia (2×, transparent outside
  the window). Every shot but the Picture in Picture set is a 0.2.35 capture (the export, re-signed to inject
  the dylib): `screencapture -l <windowID> -o` of a hidden test instance drawn as the active window by
  `scripts/draw-active.m` (how to build and inject it is in its header), at 1440 × 900 pt (`address-*` 1360 × 860,
  `little-ardia` 900 × 640, `privacy` 820 × 640), light appearance except `split`, `extensions` and `privacy`
  (dark). The PNGs' Display P3 values go into the WebP as they are (`cwebp -q 85 -m 6 -alpha_q 100`), no colour
  conversion. The profiles are Personal (plum), Work (blue) and Side project (orange). `window.webp` is the
  showcase: the Liquid Glass pinned tiles and Wikipedia's article on The Hay Wain. `tab-group.webp` is a tab
  dropped on a tab (0.2.34) and `little-ardia.webp` a Little Ardia window. `pip.webp` is 0.2.13 (a hidden
  instance's PiP window never draws): the window on Wikipedia with the Picture in Picture window where Chrome
  opened it, its real shadow from `screencapture -l`; `pip-loop.{mp4,webm}` is that rectangle over 7 s of SCK
  captures of the PiP window, laid over the still by `Shot.astro` (its `loop` prop;
  `scripts/loops.ts` plays it, never with reduced motion or Save-Data). `game/crowd.webp` is the offline game's
  canvas; its hotspot is in `Game.astro`. Replace a file with a new capture of the same name; Astro makes the
  AVIF/WebP sizes. On phones a shot shows only its `focus` region (see `Shot.astro`), so
  check the crop after replacing one. Each shot sits on a painted `Plate.astro` (sky, hills, sun and grass in its
  hour of the day).
- **Paint:** the page walks from morning to night: each section's `--bg`/`--wash` is a time of day (tokens in
  `global.css`), joined by brush-edged tops (`.paint.edge`). `src/assets/paint/` holds the textures:
  `impasto.webp` (strong, for small fills, plates and buttons), `impasto-soft.webp` (behind text), `grain.webp`
  (the canvas weave on the body), `edge-{a,b}.svg` (the brush edges), `grass.svg` (the plates' fringe), and
  `hills.png` / `sun.png`, the logo split in two so the closing's sun can set behind its hills.
- **the logo:** `src/assets/ardia-mark.png` is the painted hills and sun (the brand's `mark-trim.png`, from
  `output/brand/ardia/final/` in the main checkout), the source of `paint/hills.png` and `paint/sun.png`.
  `app-icon.png` (the header) is the macOS icon cropped close to its tile; `public/favicon.png` is
  the tile, rounded, at 64 px (and `favicon.ico`, the same at 16, 32 and 48 px, for clients that ask for `/favicon.ico`); `public/og.png` is the share card.
- **Fonts:** Fontsource's variable faces, with each Latin file split into the characters the site sets
  (preloaded) and the rest (`src/styles/fonts.css` and `src/assets/fonts/`, both from
  `node scripts/build-fonts.mjs`). Rerun it when new copy or a release note brings in a Latin character the
  core lacks; until then that character still renders, from the full file.

## Analytics

ardia.dev counts its own visitors: `src/scripts/telemetry/` posts events to `/otel/v1/logs` on the same
origin (OTLP/HTTP JSON; ardia.dev's nginx hands them to our OpenTelemetry Collector, which writes
ClickHouse) and rrweb session replays to `/otel/replay/<session>/<seq>.json[.gz]` (SeaweedFS, kept 30 days).
No third-party script loads. Event and property names follow PostHog's convention (`$pageview`, `$pageleave`,
`$autocapture`, `$rageclick`, `$dead_click`, `$dead_swipe`, `$exception`, `$web_vitals`, `$feature_flag_called`,
`$browser`, `$os`, `$device_type` …), so the September history in `telemetry.posthog_events` and new events read
the same. Console warnings and errors go out as plain logs. Replays mask every input and the text of anything marked `.ac-private` or
`data-private`; rrweb and web-vitals load in their own chunks after the page has. Settings (hosts, sample rate,
minimum session length, flags) are in `src/data/telemetry.ts`, with the event names (`SITE_EVENTS`), the
sources and libs, the noise rules and the replay upload contract that `scripts/stats.mjs` and `scripts/replay.mjs` import
too. Tag a link with `data-track="event"` and `data-track-<prop>="value"`, or call `capture()` from
`src/scripts/telemetry`; `src/data/telemetry.test.ts` (in `pnpm test`) fails when an event isn't listed or a listed one
is no longer sent. Every event carries `ardia_device` (`mac`, `phone`, `other`) and `ardia_os` from `Device.astro`, the
same answer the page acted on.

Visitors are sorted before the first paint (`src/components/Device.astro`): phones and tablets get
"Send to my Mac" instead of Download (`src/scripts/send-to-mac.ts`), Windows and Linux get a "Mac only for now"
line, and only Macs evaluate the `download-band` experiment (`src/components/Showcase.astro`). On localhost,
`?nndevice=phone|mac|other` and `?nnflag=band|control` force them. The experiment log is `docs/growth.md`.

Only ardia.dev reports. `pnpm dev`, `pnpm preview` and any other host stay silent unless you opt in from
the console with `localStorage.setItem("ac:telemetry", "dev")`, and then
events go to the same paths on that host and carry `environment: development`. Remove the item when you're done.
