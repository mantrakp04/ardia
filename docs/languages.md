# Languages

Ardia's language choices match [Zen's published language list](https://github.com/zen-browser/desktop/blob/dev/locales/supported-languages), checked on 2026-10-26: 40 additional locales and the default `en-US`, for 41 choices. Zen's `eu` directory is not in its published list and is not included. The app's `CFBundleLocalizations` in `apps/browser/macos/Ardia-macOS/Info.plist` is the list used at runtime.

This covers text supplied by Chromium and extensions. Ardia's own React Native and Swift interface strings are still English. An extension must supply a translation for a language to display it; otherwise Chromium uses the extension's parent-language and `default_locale` fallback chain.

## Language choices

Chromium 156's default desktop build has resource packs for 36 of these choices. Bosnian, Welsh and Icelandic are excluded from its default desktop packs; Irish and Norwegian Nynorsk have no Chromium UI pack. Those five choices retain their extension locale while Chromium's own text falls back to English. See [Chromium's locale configuration](https://github.com/chromium/chromium/blob/156.0.8078.47/build/config/locales.gni).

| Language | App and extension locale | Chromium macOS resources |
| --- | --- | --- |
| English (United States) | `en-US` | `en.lproj` |
| Arabic | `ar` | `ar.lproj` |
| Bulgarian | `bg` | `bg.lproj` |
| Bosnian | `bs` | English fallback |
| Catalan | `ca` | `ca.lproj` |
| Czech | `cs` | `cs.lproj` |
| Welsh | `cy` | English fallback |
| Danish | `da` | `da.lproj` |
| German | `de` | `de.lproj` |
| Greek | `el` | `el.lproj` |
| English (United Kingdom) | `en-GB` | `en_GB.lproj` |
| Spanish (Spain) | `es-ES` | `es.lproj` |
| Estonian | `et` | `et.lproj` |
| Persian | `fa` | `fa.lproj` |
| Finnish | `fi` | `fi.lproj` |
| French | `fr` | `fr.lproj` |
| Irish | `ga-IE` | English fallback |
| Hebrew | `he` | `he.lproj` |
| Hungarian | `hu` | `hu.lproj` |
| Indonesian | `id` | `id.lproj` |
| Icelandic | `is` | English fallback |
| Italian | `it` | `it.lproj` |
| Japanese | `ja` | `ja.lproj` |
| Korean | `ko` | `ko.lproj` |
| Lithuanian | `lt` | `lt.lproj` |
| Norwegian Bokmål | `nb` | `nb.lproj` |
| Dutch | `nl` | `nl.lproj` |
| Norwegian Nynorsk | `nn-NO` | English fallback |
| Polish | `pl` | `pl.lproj` |
| Portuguese (Brazil) | `pt-BR` | `pt_BR.lproj` |
| Portuguese (Portugal) | `pt-PT` | `pt_PT.lproj` |
| Romanian | `ro` | `ro.lproj` |
| Russian | `ru` | `ru.lproj` |
| Slovak | `sk` | `sk.lproj` |
| Swedish | `sv-SE` | `sv.lproj` |
| Thai | `th` | `th.lproj` |
| Turkish | `tr` | `tr.lproj` |
| Ukrainian | `uk` | `uk.lproj` |
| Vietnamese | `vi` | `vi.lproj` |
| Chinese (Simplified) | `zh-CN` | `zh_CN.lproj` |
| Chinese (Traditional) | `zh-TW` | `zh_TW.lproj` |

## Selection and packaging

macOS selects a supported language from the user's preferred languages and the app's localization declarations. Simplified and Traditional Chinese, Brazilian and European Portuguese, and British and American English remain separate choices. The engine's resource selection resolves regional variants such as `es-ES` and `sv-SE` to the available Spanish and Swedish packs.

The app passes its selected locale as `--ardia-extension-locale`. ArdiaCore forwards it to child processes. The extension localization code uses this locale for manifest messages, `getMessage()`, `@@ui_locale` and `getUILanguage()` in extension frames and service workers. This selection is independent of the resource pack available for Chromium's own interface and does not change the page's `navigator.language` or the existing `--accept-lang` behavior. A language change takes effect after restarting the app.

`packages/ardiacore/scripts/prune-bundle.sh` reads `CFBundleLocalizations`, the development region and resource `.lproj` directories. It keeps the corresponding Chromium packs and extension message directories, including parent-language fallbacks and uBlock Origin's default locale. The pruning switches documented in `docs/releasing.md` still apply.

## Verification

Run the bundle-pruning regression tests and the app's `startup-extension-locale` acceptance check. The latter must run against an app built with the extension-locale engine patch: an older prebuilt engine does not implement it. Verify an extension's localized manifest, options page and worker, a missing-message fallback, and restart behavior, including one of the five locales without a Chromium desktop resource pack.

The workspace typecheck and tests pass with the Node version pinned in `.nvmrc`. Bundle selection, native manifest localization and pruning can be checked without a running app. Engine compilation, the Chromium unit tests and extension rendering still require the patched engine and a built app; these runtime checks are pending in this checkout.
