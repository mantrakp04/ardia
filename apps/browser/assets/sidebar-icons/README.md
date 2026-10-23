# Sidebar icon assets

The native SF Symbols catalog keeps its existing macOS symbol names. Lucide and Duotone use those same stable conceptual names in saved values, with their own prefixes, so selecting a style does not change the selected subject.

`sources.json` records each conceptual name, its upstream glyph name, the exact upstream repository commit, and its license file. `svg-sources.json` contains the original official SVGs from those commits. Lucide includes its ISC license and the MIT notice for Feather-derived icons. Phosphor Icons uses the MIT license. Each generated PNG embeds its complete applicable copyright and license notices in a PNG `tEXt` chunk named `License`, so the notices travel with the bundled Metro assets. Lucide carries both its ISC notice and the full Feather MIT attribution; both Duotone masks carry the full Phosphor MIT notice. Keep the embedded notices and adjacent license files with redistributed assets.

Each PNG is a white alpha mask with 78 icons in catalog order: 10 columns, 8 rows, and 72 × 72 physical pixels per tile. The last two slots are empty. Tiles correspond to 24 logical pixels at 3× resolution. The renderer crops the atlas and applies the current theme colors at runtime.

- `lucide.png`: official Lucide outline glyphs, preserving rounded caps, joins, and stroke width.
- `duotone-fill.png`: official Phosphor Duotone secondary shapes, with their source opacity normalized to 1 so the renderer controls theme color and opacity.
- `duotone-stroke.png`: the remaining opaque Phosphor Duotone foreground shapes.

Regenerate offline from the checked-in source SVGs:

```sh
node apps/browser/scripts/build-icon-atlases.mjs
```

Refresh from the pinned commits and regenerate:

```sh
node apps/browser/scripts/build-icon-atlases.mjs --fetch
```

The generator validates that every catalog entry has a nonempty mask in all three atlases. No system fonts or network requests are needed during normal generation or app runtime.

Pinned SVG source SHA-256: `647df205e3d10e2758001f8958adec36dd6049ab987756111b7a5878b6f97144`.
