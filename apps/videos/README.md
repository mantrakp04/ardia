# Videos

Remotion videos for Ardia, a Remocn Studio project. Each folder in `src/videos` is a composition, named after the
folder. Render one with `pnpm -C apps/videos render <id>`, which writes `out/<id>.mp4` (gitignored).

`render` runs `scripts/deliver.sh`. Remotion's own AAC carries 2048 samples of encoder priming with no edit list, so
every hit would land 43 ms late. The script keeps Remotion's video, re-encodes the score from its WAV with ffmpeg
(whose mp4 muxer trims the priming) and checks the result with `scripts/check-sync.py`, which must report a lag of
0 samples.

Two caveats for delivery:
- **Edit list.** The mp4's audio relies on an edit list (its first packet is at pts −2112) to trim the priming.
  QuickTime, browsers and ffmpeg honour it. After uploading, download the film back from each platform (X, YouTube,
  Instagram) and re-run `check-sync.py` on it: a platform that ignores edit lists plays the audio 44 ms late.
- **macOS only.** `deliver.sh` encodes with `aac_at` (Apple's AudioToolbox encoder), which keeps peaks under
  -1 dBTP where ffmpeg's own AAC overshot. That ties delivery to a Mac.

## The launch film: "The asks"

| Composition | Size | Length |
| --- | --- | --- |
| `launch-16x9` | 1920 × 1080 | 44.8 s |
| `launch-9x16` | 1080 × 1920 | 44.8 s |
| `teaser-16x9` | 1920 × 1080 | 14.9 s |
| `teaser-9x16` | 1080 × 1920 | 14.9 s |

Every other browser asks for something. Four brass stabs carry "SIGN IN. / TRY AI. / ACCEPT ALL. / UPGRADE.",
each over a site interrupting you in a real Ardia window: a login wall sliding up, an AI copilot panel sliding
in over an article, a cookie wall, an "upgrade to keep typing" modal, with a pointer heading for each button. Then
the asks get stamped onto it on a snare roll. Ardia's painted hills (the logo) rise beside the pile, lean back
and shove it off on the drop, and the sun rises over them as "ARDIA — THE SIDEBAR BROWSER FOR MAC" lands,
glinting as "ASKS FOR NOTHING." is stamped. (The sun has already peeked over the window to cheer the first NO.)

The product follows, live:
- clicking down the tabs and scrolling a page;
- the profile swipe (Personal → Work → Travel → Side Project), each profile's name and colour switching on the
  frame its page changes, then "WORK NEVER SEES YOUR WEEKEND.";
- split view with the divider dragged, the hills peeking up over the bottom edge and the sun springing up for
  "ONE WINDOW.";
- the built-in blocker switched off and on, its count climbing ("BLOCKS ADS AND TRACKERS.");
- "IT'S ACTUALLY CHROMIUM.".

The window waits on the stock's colour, two fingers settle on a trackpad, the first drag starts inside a beat of
true silence, and the page change *is* drop B: five profiles in eight beats, each named on the frame it lands, the
paper taking each profile's colour. Then:
- "ANY CHROME EXTENSION." with "NO THANKS." stamped on Chrome's own prompt;
- "SEVEN APP ICONS. ONE DOCK." (the seven painted icon variants, from Settings › Appearance);
- four "NO" cards;
- ardia.dev typed into the address bar, the camera diving into the site's "Touch grass.";
- "TOUCH GRASS." on the end hit, then the end card: the icon, the name, DOWNLOAD FOR MAC / ARDIA.DEV and the GitHub address, beside the painted mark:
  the sun rises over the hills on the hit, hops on the three march taps and leaps on the last brass button, glowing.

The film uses about 80 words on screen. The type is the site's poster system on warm stock: Archivo, Newsreader and
Martian Mono, with the tie's blue and the stamp's red.

`src/lib/ac-launch` holds the film:

- `cuts.json` holds the tempo (128.57 BPM, so a beat is exactly 14 frames at 30 fps), each cut's arrangement,
  silent windows and sound effects in beats, and the master's loudness. The score and the edit both read it.
- `plan.ts` is the edit as data: the shots in beats and every text and placed object with its defaults for both
  aspects. It has no imports. Portrait keeps everything that matters inside y 220–1480 and x 60–940, clear of
  Reels, TikTok and Shorts captions.
- `shots.tsx` has one component per shot: camera moves and cuts, footage frame choice, swipes timed so each page
  change lands on its beat, the pointer, and the logo's moves.
- `kit.tsx` has the window (real footage, the macOS corner and shadow, a camera that can aim a window's corner at
  the frame, and motion blur used only on the dive), the pointer, the trackpad glyph, the type styles, the springs
  and the paper.
- `Mark.tsx` draws the logo (docs/brand/ardia): the hills and the sun as two layers cut from the same painting, so
  the sun can rise from behind the hills, hop and glow while the hills rise, lean and shove. Pure in time.
- `Film.tsx` places the shots on the beat grid and plays the score. `footage.json` indexes the captured frames;
  `scripts/capture/composite.py` writes it.

### Editing in Remocn Studio

Each video has a `studio.json`, the Studio document. It covers every text (copy, size, colour, plate and box) and
every window's rest pose (x, y, size, rotation), in that video's own coordinates. Each object is bound on the
canvas, so the owner can retype a line, drag a window or resize a box in place. Animation is added on top of the
saved values: a camera zoom or a slam's entrance never overwrites them, and slams shrink to fit their box, so an
edited line never runs out of the frame. Timing stays in `plan.ts`.

The runtimes are copied from Studio: `src/lib/studio-objects-v6` (the provider, with deletion) over
`studio-objects-v5` (readers, geometry, text bindings). `node scripts/studio-docs.mts` adds any object `plan.ts`
declares that a document lacks. It keeps existing values, removals and operation history.

## The Shared Folders film

| Composition | Size | Length |
| --- | --- | --- |
| `shared-folders-16x9` | 1920 × 1080 | 66.6 s |
| `shared-folders-9x16` | 1080 × 1920 | 66.6 s |
| `shared-folders-16x9-novo` | 1920 × 1080 | 66.6 s, music and effects without the narration |

The film runs in five parts:

1. **Chats.** Four stand-in group chats (a thesis, a product launch, a trip, a study group) bury their links: "wait which link??", "can someone resend 🙏", someone scrolling up through the history.
2. **The turn.** The thesis chat's links panel opens (47 links), and five of its cards lift out and land as the rows of Priya's shared "Thesis Reading" folder.
3. **The swell.** On the music's first swell the folder lands in four real Macs at once: Priya (light), Tomás (dark), Jun (sidebar on the right) and Ava (top tab strip).
4. **The explanation.** Narrated and paced on measured Apple Mac films (`output/videos-reference/shared-folders/APPLE-NOTES.md`):
   - Share Folder… and the share picker's Collaborate;
   - the real files in iCloud Drive;
   - a drag on one Mac arriving on the other;
   - a rename on one Mac and a reorder on the other, both arriving live.
5. **The montage.** A dark user-story montage in which each story is a real cause on one Mac and its arrival on the others:
   - a lab with a link dragged three folders deep;
   - a trip landing in the top strip;
   - a class where the teacher's link reaches three students.

It ends on a chat callback ("it's all in the folder 📁") and the end card. Captions and labels carry the story without sound.

`src/lib/sf-film` holds the film. `cuts.json` is the grid: 100 BPM, 18 frames per beat, 111 beats, with sections and narration beats. `plan.ts` holds shots, panes, cameras and captions for both aspects. The rest:
- `shots.tsx`;
- `chat.tsx` (the stand-in chat);
- `parts.tsx` (the macOS menu, share picker and halo);
- `morph.tsx` (arrivals composited from captured before and after frames);
- `kit.tsx` and `Film.tsx`.

`src/entries/shared-folders.tsx` registers only these three compositions, so `VIDEOS_ENTRY=src/entries/shared-folders.tsx pnpm render <id>` works while another film in `src/videos` is half-written. `scripts/sf-studio-docs.mts` writes their `studio.json` documents.

### Footage

Every Ardia pixel is captured from hidden Debug instances whose `sharedFolders` location is a scratch folder they share. The sync is the app's own (`docs/shared-folders.md`, "Testing it"), and nothing touches iCloud Drive.

```bash
scripts/capture/sf-run.sh <Debug Ardia.app> <scratch dir>          # Priya and Tomás: share, add, drop, rename, reorder, subfolder
node scripts/capture/sf-vignettes.mjs <Debug Ardia.app> <scratch dir> [turn launch lab trip class]
python3 scripts/capture/sf-composite.py <scene>…                    # every .capture/sf-* and <vignette>-* folder
```

- **Stories.** `sf-vignettes.json` describes each story: its people (name, colour, light or dark, sidebar left or right, or the top tab strip), their tabs, the owner's folder tree, and the actions. The runner launches one instance per person, shares the folder, adds it on every other Mac, then performs each action while every other instance watches.
- **Drags are real.** Each step is a mouse event through the sidebar's own drag controller, with one step per film frame and one snapshot per step.
- **Arrivals are real.** A watching instance snapshots from the moment its store changes, with sidebar motion slowed 5×.
  - In a sidebar, the film composites the arrival from the real before and after frames: rows slide by their measured offsets and a new row's slot grows.
  - In the top strip, the new tab's slot opens at the insertion point and the tabs to its right slide over by its measured width.
  - Measured locally, a change takes 0.9–1.2 s to reach the other sidebar. The film's commit-to-arrival gap is 0.8–1.4 s.
- **Composited, not captured:**
  - the chats, drawn in the look of macOS Messages at the owner's request: invented people, `*.example` link previews, its Info › Links view, and no app icon, Apple logo or "iMessage" on screen;
  - the context menus (drawn from the `menu.json` items the app dumped, with SF Symbols rendered by AppKit);
  - the share picker (background mode only logs it), recreated in the macOS look with the system's own app and folder icons.
- **Pages.** The pages are stand-in sites with CC0 photos and no people in them (`sites/SOURCES.md`).

### Audio

`scripts/music/shared-folders.py` mixes the film from `cuts.json`. Every file is generated with ElevenLabs on the account's paid Creator plan, which includes a commercial licence; `scripts/music/samples.md` lists each one.

- **Music.** An instrumental Eleven Music (`music_v2_5`) score generated from a composition plan with instrumental-only section labels. It measures 100.00 BPM and is edited on beat boundaries:
  - the turn lands on 16;
  - the swell on 24;
  - the montage lift on 82;
  - the resolve on 101.

  Speech-to-text finds no words in it, and the voice isolator finds no voice.
- **Narration.** ElevenLabs `eleven_multilingual_v2` with "Ardia Warm Baritone", a Voice Design narrator rather than a clone of anyone. Two other candidates are in `public/music/shared-folders/voice-candidates/`.
- **Master.** Matched to the measured Apple films: −16 LUFS and a light dip under the voice.

To recreate the mix, run `python3 scripts/music/shared-folders.py --check`. It writes `shared-folders-16x9.wav`, `shared-folders-9x16.wav` and `shared-folders-16x9-novo.wav` to `public/music/shared-folders/`.

## Recreating the media (not in git)

`public/footage`, `public/music`, `public/fonts`, `public/brand` and `.capture` are gitignored. To rebuild them:

```bash
cd apps/videos
scripts/prepare-assets.sh          # fonts, the logo (app icon, mark, its sun and hills), macOS pointers (AppKit)
python3 scripts/capture/sites/fetch-images.py   # CC0 / public-domain photos for the stand-in sites
scripts/music/fetch-samples.sh     # the CC0 samples (public/music/samples)
python3 scripts/music/score.py     # public/music/launch.wav, teaser.wav (numpy + scipy)
# footage: a DEV build, captured hidden (needs Metro on :8081, like any DEV instance)
../../scripts/agent/build-app --as videos
scripts/capture/run-all.sh ../browser/build-videos/Build/Products/Debug/Ardia.app <scratch dir> [scene…]
```

### How the footage is made

Every UI pixel comes from Ardia itself, never a mock-up. `run-all.sh` launches a hidden DEV instance
(`ARDIA_BACKGROUND=1`, a scratch `ARDIA_DATA_DIR`, `--session` from `scripts/capture/session.mjs`). That
session has five profiles, each with real sites, in light appearance with the address in the toolbar, so each
profile's name sits next to the traffic lights in its colour:
- Personal (plum)
- Work (blue)
- Travel (orange)
- Side Project (green)
- Weekend (yellow)

The script runs each scene in `scripts/capture/scenes` through the dev harness (`cap.mjs` with `prelude.js`).
The screen was locked when these were made (2026-10-03), so WindowServer recording came back black and everything
is captured in-process, frame by frame:

- **The window** is the app drawing its own layers (`ac.shell.devSnapshotWindow`, 2x).
- **Stand-in sites.** The hook's four interruptions and the blocker's dictionary page are pages built for the film
  in `scripts/capture/sites/` (moodwall.example, dailyledger.example, crumbs.example, docpad.example and
  lexicon.example). They carry no real brand, logo, headline or photo. `sites/serve.mjs` serves them, and the
  instance maps `*.example` to it with `--host-resolver-rules`, so the address bar shows their names.
  - Their photos are CC0 or public-domain files from Wikimedia Commons, fetched and licence-checked by
    `sites/fetch-images.py` (gitignored; `sites/SOURCES.md` lists each one).
  - Each interruption is the page's own animation, stepped through `window.__t(0…1)`, with a page picture taken
    every step.
  - The dictionary loads the usual ad and tracker tags. Its house "ads" fill only once the ad network's tag has
    loaded, so switching the blocker on really empties them, and the count reads "13 blocked on this page".
- **The end card's icon cycle** uses the seven app icons cut from the real Settings › Appearance capture
  (`icons.py`).
- **The pages** are each tab's own picture of itself (`WebViewHandle.capturePicture(2)`), taken again for every
  frame where the page moves.
- **Live motion**, one real state per film frame:
  - **Profile swipes:** fed step by step through the real gesture tracker (`acSwipe.sidebar(W).devSimulate`).
    Profiles always change through the swipe, because a programmatic switch leaves the pager mid-move.
  - **Typing:** ardia.dev typed a key at a time through the window's key path (DEV `type:`), with the
    field's inline completion, then Return.
  - **Scrolling:** the page scrolled step by step with a picture each step.
  - **The split divider:** the panes' sizes set step by step as the divider's drag sets them, both panes
    re-pictured each step.
  - **The blocker:** Site Controls' Block Ads & Trackers switch flipped through its own `onChange`, its knob
    animation slowed 12x, with the page reloading and the blocked count climbing, snapshotted as fast as they come.
- **Compositing** (`composite.py`):
  - The snapshot is transparent where the app draws with Metal (the window tint), so the profile's tint goes
    underneath, sampled from the snapshot and cross-faded by the pager's position during a swipe.
  - Each page's picture goes where the snapshot shows its placeholder. Blank pictures (a page captured before it
    repainted) are skipped.
  - The traffic lights are AppKit's own buttons, drawn offscreen as an active window (`lights.swift`). The
    pointer is AppKit's `NSCursor` artwork (`cursor.swift`).
- **The ardia.dev frames** were captured (2026-10-03) while the site still showed the old mascot and copy. The
  film brings them up to date in place (`SiteLogo` in `shots.tsx`), laid out as `apps/site` lays the page out at
  that width: the hero figure becomes the painted logo with its "NO ACCOUNT" stamp and caption, the headline and
  lede become "Touch grass." and today's lede, and the header's wordmark, icon and section links and the tab's title
  and favicon follow. Recapturing `typing` once the new site is live makes this unnecessary.
- **Stale footage until the next capture** (2026-10-11): `swipe` was captured with the orange profile named
  "Campaign" on political Wikipedia pages, and `block` with the dictionary page on "immunity". `session.mjs` and
  `sites/lexicon.example` now set up "Travel" and "meadow"; rerun `run-all.sh … swipe block` (and `warm` first) to
  bring the window's own profile name, its tabs and the page in line with the "TRAVEL." plates.
- **The app icons** (`windows`, label "appearance", and the end card's cycle) were recaptured on 2026-10-10 from the
  Debug build with the painted logo.
- **Not captured:** the sidebar's translucency over the desktop. It needs a WindowServer capture.

## Music and sound

`scripts/music/score.py` is a sampler. It plays recorded instruments on the film's beat grid: a brass anthem
in F minor at 128.57 BPM, with brass stabs, a march-snare roll, two drops, a break that cuts to silence, an
end hit, march taps and a final brass button.

- **The main stab** is a designed hybrid: unison saws with a filter envelope, a short noise transient and the sampled
  brass as its body, saturated, glued and sent to a room and a plate. It plays the intro stabs, the four NO-run hits,
  the end hit and the button.
- **Produced layers:** a driving saw bass and the 909 kit carry the drops, sidechained, with a pluck in drop A. The
  score uses no recorded voices.
- **Swipe sound:** a filtered noise sweep timed to peak on the frame each swipe commits.
- **For a composer:** `MUSIC-BRIEF.md` maps the grid, hits, silences and the button, so a produced track can drop in.
- **Feel:** inner notes are humanised (seeded jitter and velocity, two dynamic layers, round robins). The
  `breaths` field in `cuts.json` drops the kick, bass and hats under brass stabs (the NO run), then slams back.
- **Sources:**
  - Brass, timpani, cymbals and the concert bass drum come from VSCO 2 Community Edition.
  - The rope-tension march snare, claps, tom, slapstick and woodblock come from the Versilian Community Sample
    Library (both by Versilian Studios).
  - The 909 kick, clap and hats come from MckSamplePacks' TR-8 recordings.
- **Licence:** all three are CC0 1.0 (public domain), so the score can be published anywhere, commercially
  included, without credit. `scripts/music/samples.md` lists every file with its upstream commit and licence.
- **Synthesized parts:** only the sub under the kick and bass, the riser, and the whoosh and swipe noise.
- **Timing and master:** the arrangement, sound effects and silent windows come from `cuts.json`. The master is
  -11 LUFS integrated with true peak at most -1.6 dBTP, so it stays under -1 dBTP after AAC encoding.

To recreate the audio:
1. Run `scripts/music/fetch-samples.sh`. It downloads and checks the samples into the gitignored
   `public/music/samples`.
2. Run `python3 scripts/music/score.py` (needs numpy, scipy and ffmpeg).
3. `python3 scripts/music/analyze.py` measures the result.

Other assets: the fonts are Archivo, Newsreader and Martian Mono (SIL Open Font License, via apps/site's
Fontsource packages). The logo and the app icon are the project's own. The pages shown are public sites as they
appeared on 2026-10-03.

## Checking a render

```bash
pnpm exec tsc --noEmit
pnpm -C apps/videos render launch-16x9
ffmpeg -i out/launch-16x9.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12   # -11 LUFS, true peak under -1 dBTP
```

Then extract a contact sheet (one frame per beat: `select='not(mod(n\,14))'`, tiled) and look at it.
