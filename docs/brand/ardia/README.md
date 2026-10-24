# Ardia logo

Two oil-painted hills (sage `#71955A`, forest `#203F32`) under a sun (`#E6BC62`), on a parchment tile (`#F9F5E3`).
`source/` holds the three paintings, generated with Codex image generation (round 5, "hills"):
`app-icon.png` (the tile), `mark.png` (the hills alone) and `mark-small.png` (flat colours, for 16 pt).

`python3 docs/brand/ardia/build.py` (numpy, Pillow, SciPy) builds every size into `output/brand/ardia/final/`. Where they go:

| Built file | Slot |
|---|---|
| `apps/browser/macos/Ardia-macOS/AppIcon.icon` (written there: the parchment as the Icon Composer fill, the back hill, the front hill and the sun as three layers un-blended from it, so the default look renders back to the tile within 2 levels) | the app icon on macOS 26 and later, which draws its dark, clear and tinted appearances from those layers; Xcode 26+ also renders the icon for older macOS from it (`AppIcon.icns` and the car's `AppIcon`), so the `.appiconset` below only matters to an older Xcode |
| `icon-1024.png` (Apple's template: 824 px body at a 100 px inset, with its shadow) | `apps/browser/macos/Ardia-macOS/Assets.xcassets/AppIcon.appiconset/*` (each size) |
| `plate-mark-1024.png`, `plate-mark-<colour>-1024.png` | `AppIconMark.imageset/mark.png` and `AppIconMark-<colour>.imageset/mark.png` (build.py writes them at 512 px: the plate draws the hills at 363 px at most, in the largest Dock icon): the plate app-icon variants (`packages/shell/ios/AppIcon.swift`), hills tinted to the plate as on the New Tab page (plum, blue, neutral) |
| `ntp-mark[-<colour>]-{back,front,sun}*.png` | `apps/browser/assets/`: the New Tab page, hills on the bottom edge rising from behind the bar, as three layers that rise one after another (the light hill behind, painted on under the dark one; the dark hill; the sun); one set per profile colour (green is the brand painting). `ntp-mark[-<colour>]*.png` is the whole painting the layers are cut from (not installed) |
| `new-tab-mark*.png` | `apps/browser/assets/new-tab-mark*.png`: one colour (drawn tinted), hills split and the sun cut free |
| `icon-512.png` | `apps/browser/assets/app-icon.png` (drawn at 132 pt at most) and `extras/raycast-ardia/assets/icon.png` |
| `apple-touch-icon.png` | `apps/site/public/apple-touch-icon.png` |
| `engine/chromium/src/chrome/app/theme/chromium/mac/{app.icns,Assets.car}` (written there, from `icon-1024.png` through `actool`, 128 pt at most) | the Chromium Framework's Alerts helpers, whose icon macOS shows on every web notification and in System Settings › Notifications, both far smaller than 256 px |
| `engine/chromium/src/…/product_logo*.png`, `favicon_product.png`, `product_logo{,_animation}.svg` (written there: the flat tile at 92 % of the square, no shadow) | Chromium's `IDR_PRODUCT_LOGO_*`, `IDR_PRODUCT_FAVICON` and the framework's `Resources/product_logo_32.png`: chrome://settings/help, chrome://version, the profile picker, the task manager, the screen-share picker, payment and sign-in dialogs. Chromium's wordmarks (`product_logo_name_22*`, chrome://version's `product_logo*`) become the tile alone: Ardia has no wordmark |

The site's header icon, favicon and share image are cut from the same files (`apps/site`).

The `engine/chromium/src` files replace Chromium's own: `engine/chromium/apply.sh` copies every file there outside
`chrome/browser/ardia` over the tree's, so a change ships only after `scripts/agent/engine-build` (the paks and the
helpers are rebuilt, not the framework's binary; `release.sh` refuses a framework older than them). Commit them with
the rest of a re-run.
