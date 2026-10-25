# Profile dial and unified icons

Plan and measurements for the sidebar footer profile dial, Unicode glyphs for every icon
picker, and one icon vocabulary across the browser.

Status: built 2026-10-24 (phases 1–3 on `main` locally), then reworked the same day into the
cylinder dial (`profile-dial-cylinder.md`). Numbers are ours, not Dia's: Dia's space switcher
has no dial. Phase 0 (merging #128 and #118) is blocked: this session's GitHub token is
read-only, so the PRs stay open. The "More Emoji..." cell waits on #118. The dial's end-to-end
check ran on a Debug build on 2026-10-24 (8/8); captures are still outstanding.

## Why

The footer switcher is a row of identical dots (`profiles/ProfileDots.tsx`). Issue #140 asks
for each profile's icon there. Reordering profiles exists only in Settings › Profiles
(vertical `PanResponder` list), while `docs/dia-feature-parity.md` lists footer
drag-to-reorder as a gap. Profile icons are a fixed native menu of 20 SF Symbols and 20
emoji; folder and tab icons use a separate in-app picker with a curated emoji list and SF
Symbols, and have no way to use a plain Unicode character.

Open work this builds on: PR #128 (icon or initial in the dot row, single-emoji detection,
compact fallback), PR #118 (macOS Character Viewer for profile emoji). PR #109 (icon
atlases, three styles, colour) stays open; the picker keeps its icon sources behind one data
module so those sets can be added to the Symbols tab later.

## The dial

A horizontal tuner in the sidebar footer, replacing the dots. The current profile sits at
the centre; each profile is a glyph above a tick; the scale slides under the centre. The
glyphs stay visible; only the scale (ticks and baseline) is hidden at rest. One mode: the scale is always centred on the current profile, so
there is no scroll view and no overflow branch. Far profiles are clipped by the band.

| Part | Value |
|---|---|
| Footer height | 52 pt (was 41) |
| Band | 38 pt, top 6, bottom 8 |
| Baseline hairline | 0.5 pt at y = 28, alpha 0.12, running from the first glyph to the last |
| Slot pitch | 36 pt |
| Glyph | 15 pt idle, 17 pt current |
| Glyph opacity | 0.55 idle, 0.85 hover, 1 current |
| Tick | 1 x 6 pt, alpha 0.22 idle, 0.55 hover, 1 current |
| Current tick | 1.5 x 8 pt |
| Scale appearance | the ticks and baseline fade in over 0.12 s; after a switch they stay 1.2 s, then fade out over 0.18 s; shown while pressing or dragging, hidden again 0.9 s after the release. The glyphs never hide |
| Lift (reorder) | scale 1.18, 22 pt pill at alpha 0.12, zIndex 2 |
| Reflow spring | 0.22 s response, 0.9 damping ratio |
| Tune rubber band | `rubberBand` from `swipeMotion.ts`, c = 0.15 |
| Drag threshold | 3 pt |
| Hold to reorder | 350 ms without moving |

Interactions:

- Click a glyph: switch profile through the existing pager (`switchProfile(windowId, id, true)`).
- Click the current glyph: open the profile menu, as the header indicator does.
- Plain drag: tune. The scale follows the pointer, a detent and `hapticTick` per slot. The
  switch commits on release to the nearest slot, so passing through profiles costs no page
  churn or tint cross-fade. The scale holds the release position while the pager settles and
  only recentres once the profile index changes, so it never flashes back to the old profile.
- Option-drag, or hold 350 ms then drag: reorder. The glyph lifts, the others part, a haptic
  per slot, release calls `reorderProfiles`. Vertical drag past 20 pt or Escape cancels. Any
  glyph can be moved; the current one is only the emphasised one.
- Right-click a glyph: Switch to Profile, Change Icon..., Edit Profile..., Make Default,
  Move Left, Move Right. Move Left/Right is the keyboard and VoiceOver path.
- Container is `adjustable` with value (index, count, name); increment/decrement switches.
  Each glyph is a button whose hint names both gestures.
- Hidden for incognito windows and for a single profile, as the dots are.
- Below 150 pt of room, fall back to today's 6 pt dots on a 12 pt pitch (from #128).

Reordering is safe for the native pager: `SwipeModule.configure` already remaps its selected
index by profile id when the order string changes (SwipeModule.swift, `configure`).

### Second pass: the cylinder (current)

The current dial is the egg-timer cylinder described in `profile-dial-cylinder.md`; the table
above is the first pass, kept as history. What changed:

| Part | Shipped |
|---|---|
| Footer height | 52 pt, the first pass's height |
| Band | 36 pt at top 6, one horizontal cylinder: pitch 36 pt, radius 170 pt (12.13 deg per slot) |
| Projection | orthographic: `translateX = 170 sin(angle)`, `scaleX = cos(angle)`; a real `rotateY` with a 900 pt perspective does not render on the native `Symbol` and `Text` glyph children, so it was rejected |
| Chrome | no ticks and no groove; the profile name as 11 pt theme text at the footer's top, then the glyph band at y 18..44 |
| Glyphs | 12 pt base, magnified by a tight Dock-like bell curve (1.8x at the centre, 1.08x one slot out, 1x two out), always visible; cells fade to 0 over the last 40 pt at each band edge (4 pt inset) |
| Auto-hide | the name only; the glyphs never hide |
| Tune preview | the text shows the previewed profile's name while dragging |
| Inactive icons | monochrome: SF Symbols and glyphs in ink, emoji desaturated through the native `ArdiaSymbol` emoji mode and adjusted for the theme ink; only the selected profile keeps its colour |

Everything else holds: a click switches, a drag tunes and commits on release, option-drag or
a 350 ms hold reorders, and the compact dots fall back under 150 pt of room. The on-screen gap
between adjacent slots shrinks away from the centre (35.7, 34.2, 30.9, 26.2 pt for the first
four), so hit tests and the e2e use `acDial.slotX`, not `centre + slot x pitch`.

## Icon vocabulary

One `icon: string | null` field, unchanged, classified at render time:

| Kind | Storage | Render |
|---|---|---|
| SF Symbol | `symbol:<name>` | `Symbol`, tinted |
| Emoji | one emoji grapheme | `Text`, full colour |
| Glyph | one non-emoji grapheme (`◆`, `→`, `§`, `⌘`) | `Text`, tinted |
| Initial | `null` | profile initial, or the target's fallback |
| Legacy text | anything else | first two characters, tinted |

- `components/icons/classify.ts` is pure and tested: symbol prefix, single-emoji regex
  (regional indicators, keycaps, ZWJ, skin tones, tags, VS16), single glyph (one base code
  point plus combining marks, no ZWJ, no whitespace or control).
- `components/icons/IconGlyph.tsx` renders all five kinds. `TabIcon`, `ProfileBadge`, the
  group row, live folders, the sidebar header indicator and settings rows use it.
- Glyph set: `components/icons/glyphs.ts`, about 140 characters in six groups (shapes,
  arrows, marks, typography, currency and units, technical, cards and music), each with
  search keywords. A unit test asserts every entry classifies as a glyph, not an emoji.

## One picker everywhere

`components/icons/IconPickerPanel.tsx`, hosted three ways:

- Sidebar overlay (today's `sidebar/IconPicker.tsx` placement, outside the sidebar).
- Settings, inline under the Icon row of Profile Details and in the Create Profile sheet, so the
  pane's ScrollView cannot clip it.
- Inline in the Create Profile sheet.

Tabs: Symbols, Emoji, Glyph. The search field doubles as a glyph input: a query that is one
grapheme shows a "Use <char>" cell first; Enter picks it. Emoji tab keeps the curated,
keyword-searchable list and will end with "More Emoji...", which opens the macOS Character Viewer
(PR #118, not merged here) for the full set. Reset means favicon for a tab, a neutral `folder` symbol
for a group (issue #155), and the initial for a profile.

Adoption: sidebar rows, tiles, groups, live folders, top tab strip, dial, profile badge in
Little Ardia and Sync, Settings › Profiles list and details, the header indicator, Create
Profile.

## Phases

0. Land #128 and #118; close #105, #25, #97; keep #109 open. Blocked in this session: the
   GitHub token is read-only, so these stay open until the owner merges.
1. Icon core: classify, glyph set, IconGlyph, adoption, unit tests. Done.
2. Picker: panel extraction, Glyph tab, glyph input, profile and Create Profile wiring,
   reset semantics. Done except "More Emoji..." (waits on #118) and the picker's own end-to-end
   check.
3. Dial: layout math, component, Sidebar and footer constants, gestures, menu,
   accessibility, dev handle, compact fallback. Done.
4. Verification and docs: unit tests, parity, spec and testing docs done; `profile-dial-test.mjs`
   updated for the cylinder and run on a Debug build (8/8, 2026-10-24); captures outstanding.

## Verification

Unit (passing): classify (emoji sequences, glyphs, symbols, legacy), glyph set validity, dial
layout (slot x, nearest slot, clamp, reorder result), store `moveProfile` and
`reorderProfiles`. `apps/browser` typechecks and Metro bundles the whole app.

End to end (`apps/browser/scripts/profile-dial-test.mjs`, hidden instance, `devWindow` mouse
actions, every click and drag aimed with `acDial.slotX`):

- the footer is 64 pt, pitch 36 and radius 170, and the slots sit on the cylinder's x;
- one face and glyph per profile, the current one centred;
- click switches;
- a plain drag tunes and commits only on release;
- option-drag moves the non-current glyph it started on, drops it one cylinder gap away, and
  keeps the window's profile; hold-then-drag reorders too;
- the order reaches `session.json`;
- the menu's move action keeps every profile once.

Run 2026-10-24 on the `build-flash` Debug app: 8/8. The synthetic injector can stop
delivering dragged events to a background window after a pause in the down state; the
hold-350 ms check says so and skips with that reason when it sees it, rather than failing.

The picker has no end-to-end check yet.

Captures: light and dark, 2, 3 and 8 profiles, hover, mid-drag, each picker tab, narrow
sidebar. In-process snapshots if the screen is locked.

## Risks

- Footer height touches the downloads popover offset (`SIDEBAR_FOOTER_DOWNLOADS`,
  `Downloads.tsx`), the auto-hidden dock math, the mini player and the list height; check
  all together.
- `SwipeArea` returns nil from `hitTest`, so mouse drags reach the dial, but a trackpad
  horizontal scroll over it pages profiles. That is useful, but it must not run during a
  reorder drag.
- Emoji are wider than glyphs; verify no clipping in the 36 pt band at both sizes.
- `TabIcon` now tints text icons, which changes existing custom icons; capture before and
  after.
- PR #118 bumps `NATIVE_API_VERSION` to 14; the first build after it needs an app rebuild,
  not a Metro reload.
