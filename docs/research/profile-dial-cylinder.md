# Profile dial: egg-timer ruler

Second pass on the dial's look, after the functional first version. Reference:
Nicolas Jesenberger's "Functional Egg Timer" (CodePen VwVVzjg), a ruler wrapped around a
cylinder: a label per face, no ticks or groove after the owner's cut,
and the profile's name above the band.

Status: built 2026-10-24 and verified in a Debug instance (`build-flash`, e2e 8/8). The
numbers below are what the code does now (`components/profiles/{dial,cylinder,ProfileDial}.ts(x)`);
the first pass's 52 pt hairline ruler stays described in `profile-dial.md` as history.

## Decisions (owner, 2026-10-24)

- Full cylinder: real cylindrical spacing, continuous rotation under the drag, stronger
  foreshortening at the edges.
- The profile name as 11 pt theme text at the footer's top, then the glyph band. The name sits above
  the glyphs rather than below them.
- The glyphs stay visible; the name still auto-hides: it fades in on a switch and while pressing
  or dragging, and fades 0.9 s after release.
- Theme colours: the current glyph keeps the profile's own colours, and the others are monochrome.
- Footer 52 pt.

## Geometry

The ruler is a horizontal cylinder seen from the front.

| Value | Meaning |
|---|---|
| pitch 36 pt | Arc length between two profiles at the centre |
| radius 170 pt | Cylinder radius; theta = pitch / radius = 0.2118 rad (12.13 deg) per slot |
| position | Animated value in slots; equals the profile index at rest |
| angle(slot) | (slot - position) x theta |
| x(slot) | radius x sin(angle) from the band's centre |
| scaleX(slot) | cos(angle), applied to the whole face |
| dx(slot) | x(slot); every cell shares the base left centre - pitch / 2 and is moved by dx |

The projection is orthographic, and that is deliberate. The first pass put
`rotateY(angle)` and a 900 pt `perspective` on each cell, which is the honest 3D transform.
It does not render: a rotateY on a React Native view does not reach the native `Symbol` and
`Text` children the glyphs are drawn with, so every face stayed flat and unsquashed and the
dial read as a plain row. Drawing the face flat and shrinking it horizontally with
`scaleX = cos(angle)` does render on those children and gives the same foreshortening at
these angles; the perspective term it drops moves the face edge by a fraction of a pixel at
the +/- 35 degrees the band shows.

Cells past about +/- 43 degrees are clipped (half a face is outside the band); with the
196 pt band the visible arc is about +/- 35 degrees (three slots each way), and a wider
sidebar shows more. Opacity fades from 1.2 to 1.45 rad.

During a tune drag, `position = index - dx / pitch` with the existing rubber band. On
release it springs to the nearest slot; when a profile switch lands, `position` is already
there. An external switch (shortcut, swipe, menu) springs `position` to the new index. A
tuned position is held until the index actually changes, so the face never snaps back to the
old profile first.

Each cell is a face: the glyph, transformed as a
whole. This matches how the pen lays a slice of the ruler on each 7.5-degree face, and keeps
the number of animated nodes to one per profile. Because the spacing is cylindrical, the
on-screen gap between adjacent slots is 36 pt only at the centre: 35.7 pt from slot 0 to 1,
34.2 pt from 1 to 2, 30.9 pt from 2 to 3, 26.2 pt from 3 to 4. Tests and captures must use
`acDial.slotX`, not `centre + slot x pitch`.

## Layout (52 pt footer)

- Name: 16 pt high at the footer's top (y 0..16), 11 pt theme text, centred, as wide as the band at
  most; no pill or background.
- Glyph band: top 18, height 26. The 24 pt glyph box centres the glyph at 30 pt from the footer's
  top, 22 pt from the window bottom, level with the downloads button. The glyph is magnified by a tight Dock-like bell curve driven
  by the same position value: 1.8x at the centre (about 22 pt), 1.08x one slot out (about 13 pt),
  1x two out (12 pt).
- No ticks and no groove.
- The glyphs never hide; the selected profile's icon is the only one in colour. SF Symbols and glyphs
  draw in ink; emoji are desaturated through the native `ArdiaSymbol` emoji mode and adjusted for the
  theme ink. Cells also fade to 0 over the last 40 pt at each band edge (4 pt inset), so a glyph
  dissolves rather than clipping. The name is the only chrome that shares the auto-hide value.
- During a tune the text shows the previewed profile's name, not the current one's; it snaps back
  to the current profile if the drag is cancelled or the detent returns to it.

## Tuning and reorder

- Plain drag tunes; the text shows the previewed profile's name per detent.
- Click a glyph switches; click the current glyph opens the profile menu.
- Option-drag or hold 350 ms then drag reorders; the lifted glyph gets the existing extra
  offset and scale, the others part by pitch. The cylinder stays; the drag offset is applied
  on top of the face transform.
- Right-click, Move Left/Right and accessibility actions are unchanged.

## Verification

The dial's dev handle (`globalThis.acDial`, `__DEV__` only) exposes `info(windowId)` (ids,
index, position, pitch, radius, footer, bandTop, glyphY), `slotX(windowId, slot)` (the
on-screen x of a slot at rest) and `rect(windowId)` (the band). `profile-dial-test.mjs` aims
every click and drag at `slotX` and asserts the 52 / 36 / 170 geometry from `info`, click
switching, tune-on-release, an option-drag on a non-current glyph landing one cylinder gap
away with the window's profile unchanged, the saved order, and the menu's move action. The
hold-350 ms drag runs too (it reordered in the 2026-10-24 run). Should the synthetic
`devWindow` mouse injector stop delivering dragged events to a background window after a
pause in the down state, the check proves it with an option-drag at the same pause and a
250 ms drag probe, then skips with that reason instead of failing; separating that from a
real long-press bug needs a real mouse. The run on `build-flash` was 8/8 in 19 s.

## Work split

- Cylinder core: `cylinder.ts`, sampling for Animated interpolations, unit tests.
- Dial visual: `ProfileDial.tsx`, `dial.ts`, footer height consumers, gestures.
- Dev icon: icon source, generation, Xcode wiring, a Debug build.
- Verification: typecheck, unit tests, bundle, e2e updates, docs, captures.
