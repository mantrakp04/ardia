# Air Traffic Control

Air Traffic Control (ATC) opens links in the profile that the user's rules choose, like Arc's feature of the same name. This doc covers what routes, what doesn't and why, how it works, and the Arc 1.169.0 measurements it follows. It matches Arc where Arc was measured; it doesn't claim full parity.

A profile here is a sidebar profile, Arc's Space. Several sidebar profiles can share one engine profile (cookies and storage) through `shareWith`/`sharedDataIds`. ATC decides and places by sidebar profile ID and loads the tab in that profile's engine profile. It never guesses one from the other.

## What routes

Rules apply to typed URLs, links from other apps, links and popups on pages (clicks, ⌘-click, `target=_blank`, `window.open`), and script navigations of a page's own tab such as `location.href` (Arc: G9, G11).

- **Rules.** Each rule has one condition, Contains or Is equal to, and one destination. Rules run in order and the first match wins (G2, E18).
- **Destinations.** A specific profile, Most Recent (the last active profile in a regular window), or Little Ardia. Little Ardia uses the source profile for a typed URL or page link, and Most Recent for a link from another app.
- **Default.** A link from another app that matches no rule goes to the default destination, which has the same three choices. Fresh installs default to Little Ardia. The default never applies to typed URLs or page links; without a match they navigate as usual (G14–G16).

| Request | Result |
| --- | --- |
| No match, or a match for the source profile | Normal navigation. A Most Recent rule matched from the most recent profile is such a match (G14, G15). |
| Same-tab navigation matching another profile | The source tab is left as it was, and its beforeunload doesn't run (G8). The destination opens in a new foreground tab in the originating window where possible, and the window switches to that profile. |
| New tab, background tab or popup matching another profile | Destination tab, foreground or background as requested. A background route doesn't switch the window. A popup keeps its size. |
| Little Ardia match | A separate Little Ardia window. The source is left as it was. |
| Link from another app | First matching rule, else the default. Each URL is its own open, so a repeat opens another tab (E2). |

### Navigations without a user gesture

A page can navigate its own tab without a user gesture, for example from a timer. Arc routes this (G11), and so does ATC, but only once per document. Later no-gesture navigations from the same document navigate the tab normally, in its current profile. Without the limit a page could keep opening tabs in another profile on its own, since a routed navigation leaves the source page running.

A new tab, window or popup opened without a user gesture isn't routed. It goes through Chrome's normal popup blocker. Navigations with a user gesture, such as clicks, route as described above.

## What doesn't route

- **Forms, GET and POST.** They stay in the tab with their query or body (Arc: G3, G4).
- **Replacement navigations.** `location.replace`, and a `location.href` assignment that runs before the page has finished loading, stay in the tab and replace its history entry, with Chrome's beforeunload handling (Arc: H5, H6, H9). Google's search page calls `location.replace` with the query in the URL, so routing replacements would move a search for a rule's text into another profile.
- **Reload, back/forward, session restore, fragment-only links and subframes.** They keep Chrome's handling. A fragment-only link finishes in Blink before ATC sees it (Arc: F5). Picture-in-picture windows aren't matched either.
- **Downloads.** A `download` link stays on Chrome's download path, with the source profile's cookies.
- **Private windows.** Arc's behavior there wasn't measured, and a private navigation must never move into a regular profile.
- **Non-web schemes.** Only HTTP(S) URLs are matched. `javascript:`, `file:`, internal pages and custom protocols keep their current handling, including the `allowJavaScriptFromAppleEvents` check for links from other apps.
- **Same-site redirects.** A redirect within the same site isn't matched again (Arc: E12, H2). Nor are redirects in a new tab or popup, or in a routed destination's own load. Cross-site redirects after a click are the exception; see "Search-result redirects after a click".
- **Explicit choices.** Opening a link in Little Ardia on purpose, moving a Little Ardia page into a profile, and switching to an open tab from a suggestion go where the user chose (Arc: E10).

## Matching

- **Contains** is a case-insensitive (ASCII) substring match on the whole URL, including path, query and fragment (E1, E13, E16, E17).
- **Is equal to** normalizes both the URL and the rule text, then compares the whole strings. Normalizing lowercases ASCII and drops a leading `http://` or `https://`, the query and fragment, and one trailing slash. The port and the rest of the host and path stay. Percent escapes aren't decoded, so `/%41TC` doesn't equal `/ATC` (G17–G26). No other equivalences are applied (`www.`, default ports, IDN, repeated slashes).
- The URL is the resolved URL as Chromium serializes it. Typed text goes through the omnibox resolver first, so rules never see raw search text. Rule text isn't parsed as a URL, because a Contains rule can be any substring.
- A blank rule stays in the editor but never matches. Saved settings are normalized on load, and malformed rules are dropped.
- Deleting a profile keeps the rules that point at it, with a blank destination (G29). Matching skips them and goes on to later rules and the default (G31, G32). A default that points at a deleted profile acts as Most Recent until the user picks another (G30, G33).

## Settings

```ts
type LinkDestination = { kind: "little" } | { kind: "recent" } | { kind: "profile"; profileId: string };
type LinkRule = { id: string; match: "contains" | "equals"; text: string; destination: LinkDestination };
type LinkRouting = { rules: LinkRule[]; defaultDestination: LinkDestination };
```

`linkRouting` lives in the settings store. Destinations use stable sidebar profile IDs, not names or engine IDs, so renames show up live. Array order is precedence. Rules have no AND/OR, regex, priority, enable switch or drag reordering. ATC settings stay out of the sync allowlist; Arc keeps them local too.

The editor is Settings → Links → Air Traffic Control. New Route adds a row (condition, text, destination), rows can be removed, and a selector sets the default. Changes apply at once; there is no Save or Apply (Arc: G1). The General pane and the menu item for links from other apps edit the same default. The Open Link Preferences command opens the pane.

`linkRouting` replaces the `openLinksInLittleArdia` boolean. A saved `false`, the old "A new tab" choice, migrates to a Most Recent default. `true` or no saved value means Little Ardia, the fresh-install default. Rules start empty.

## How it works

### Matching in the browser process, before load

There is one matcher, in ArdiaCore in the browser process. It isn't mirrored in TypeScript or the renderer; the renderer only decides whether a navigation is eligible to forward. JS publishes an immutable snapshot (rules, default, sidebar-to-engine map, most recent profile) to native and republishes it when the store changes. Native entry points read the installed snapshot locally. Every entry point matches before the routed navigation's first request, so that request carries only the destination profile's cookies. Each native tab records its exact sidebar profile, since several can share an engine profile.

The request is copied in native code (`content::OpenURLParams`: referrer, initiator, headers, transition, gesture, disposition) and never rebuilt from a URL in JS. When engine profiles differ, Chrome's own cross-profile scrub in `Navigate` clears the opener and referrer, as in Arc (G6, G10). Profiles that share an engine keep the opener (G28). A routed destination loads through `Navigator::Navigate` and never passes the renderer's `BeginNavigation`, so it can't be matched again; there is no loop marker or URL cache. Prefetch or prerender that started before a route can't be undone.

### Two Chromium seams

Two patches add null-default `g_ardia_*` hooks, declared in `ac_content_hooks.h`. A third carries `is_form_submission` and the download policy from the existing `OpenURL` message through `OpenURLParams`, `NavigateParams` and `LoadURLParams`, so forwarded navigations keep their form and download semantics; the Mojo messages don't change. Line numbers are for Chromium 155.0.8059.84.

1. **Renderer forwarding**, `g_ardia_open_navigation_in_browser`, set by `ACContentRendererClient`. In `RenderFrameImpl::BeginNavigation` (`render_frame_impl.cc:5749`), eligible top-level HTTP(S) GET navigations take Chromium's existing `OpenURL` path to the browser, before speculative warmup (5824) and before the renderer runs beforeunload (5858). Forms, reloads, history, restore and downloads aren't eligible, and the broad `browser_handles_all_top_level_requests` preference is unchanged. `ACWebContentsDelegate::OpenURLFromTab` calls `RouteOpenURL`. No match, a same-profile match, or a replacement goes to the stock delegate, whose `Navigator::Navigate` runs beforeunload and keeps Cancel (G7). A route to another profile or Little Ardia consumes the request: the source doesn't navigate and its beforeunload doesn't fire (G8). A navigation throttle can't make this split, because `WillStartRequest` runs after the renderer's beforeunload.
2. **New-window hook**, `g_ardia_route_new_window`, set in `ac_seams.mm`. In `WebContentsImpl::CreateNewWindow`, after the file-chooser check (`web_contents_impl.cc`, near 5639), it runs after Chromium's sandbox, popup-blocker and activation checks and COOP, and before a browser context is chosen or contents are created. Only requests with a user gesture are routed. A match for another engine profile is consumed; window features carry over, and `AdjustWindowRect` and `ForSecurityDropFullscreen` still run where Chrome would run them. For another sidebar profile on the same engine, or Little Ardia, native creation continues with a callback that seeds the decision into the new contents, which keeps the opener (G28). `CreateCustomWebContents` would lose request metadata and skip Chrome's normal tab setup and loading, and `AddNewContents` comes after the source context is chosen.

### Prestarted contents and adoption

Chrome's `Navigate` starts loading before a tab reaches the tab strip, so the decision travels with the pending open (`WindowHost::PendingOpen`: sidebar profile, action, original disposition, source). It's seeded into the new `WebContents` while it's created (`GetWebContentsViewDelegate`, called from `WebContentsImpl::Init`), and `TabBridge` turns the seed into the tab's identity. The UI then adopts the running contents by token (`announceOpenedTab` and `OpenWindowRequest` to `openFromPage`); it never loads the URL a second time.

Adoption of started contents is required (`requiresAdoption`). If the token is missing, expired, closed, dismissed or incompatible, `ArdiaCoreWebView` closes the view and disposes of the unclaimed contents. It doesn't fall back to `openTab(url)`, which would request the URL a second time. The view's URL, profile and adoption props are applied as one batch at Expo's props-completion boundary, because Expo sets props in no fixed order. A pending open that waits for a profile to load is canceled by Stop, by closing the source, or by replacing its document. A deleted destination or a failed profile load never retries in another profile, and editing rules doesn't rematch an accepted open. After handoff the destination is independent: closing the source doesn't close it. The original background intent is kept even when Chrome turns the first tab of an empty window into a foreground tab, so a ⌘-click doesn't activate the destination window.

### Search-result redirects after a click

A Google result links to an opaque `https://www.google.com/goto?url=…` URL that redirects to the site, so the clicked URL has no rule text. A clicked same-tab navigation that wasn't routed (no match, or the source profile) is tagged with its request, source tab and profile, and `RedirectRouteThrottle` reads the tag in `WillRedirectRequest`. Same-site hops continue. At a cross-site hop (`SchemefulSite` differs from the source's origin), it checks that the source tab, profile and document are unchanged, and cancels if not. Then it matches the new URL. A route to another profile or Little Ardia opens the redirect target in the destination through the same native path and cancels the source navigation, so the results page stays. Replacement, form, POST, reload, history, private and subframe navigations aren't tagged. This goes further than Arc did with a local cross-host redirect (H3) on purpose, so that clicking a real Google result ends where it does in Arc.

### Typed URLs and links from other apps

Typed input is matched after omnibox resolution and before `openFromBar` or `openFromNewTabBar` changes any tab; `store.navigate` starts the native request before publishing state, so later is too late. A route to another profile or Little Ardia creates only the destination and leaves the source tab and its group unchanged (Arc: E3, E4). After the async match, the originating window, tab and command are checked again. A superseded command can't open a late destination, and a deleted destination is rejected instead of falling back to a default profile.

Links from other apps get one result per URL, in input order: profile, action, and an adoption token if the URL already started. Matching runs before the early Little Ardia window or a parked launch page can start a URL. At cold launch, before JS runs, native reads the saved `linkRouting` and a `linkProfileId` hint saved with the session for Most Recent; the hint replaces the engine-only `linkProfile`. A launch preload only starts if the destination's engine profile is already loaded; otherwise the link waits for the normal profile load, and another loaded profile is never used instead. A page that started before JS hydrated keeps its decision and is adopted once, not matched again; if that handoff doesn't happen in time, the destination is discarded, not replayed. If resolution fails, the link isn't opened in a guessed profile; only a real no-match uses the default.

## Where the code lives

- Settings: `apps/browser/src/store/linkRouting.ts` (model, normalization, migration), `store/settings.ts`, `store/browser.ts`, session hint in `lib/persist.ts`; editor in `components/settings/panes/Links.tsx`, default in `panes/General.tsx`, search in `settings/settingsIndex.ts`; command and menu in `components/omnibox/actions.ts`, `lib/commands.ts`, `lib/native.ts`.
- Snapshot install and resolution: `apps/browser/src/lib/linkRoutes.ts`; typed routing in `components/omnibox/typedRoutes.ts` and `Omnibox.tsx`; links from other apps in `components/littleArdia/actions.ts`.
- Placement and adoption in JS: `apps/browser/src/components/layout/openFromPage.ts`, `components/ContentCard.tsx`, `store/tabs.ts`, `store/windows.ts`.
- Bridge and native views: `engine/ardiacore/src/ardia/core/public/ArdiaCore.h`, `ardiacore_api.mm`, `packages/ardiacore/src/module.ts`, `packages/ardiacore/ios/CefModule.swift`, `ArdiaCoreHost.mm` (early launch), `ArdiaCoreWebView.mm`, `ArdiaCoreChromeWindow.mm`; native API version in `apps/browser/src/nativeApi.tsx` and `packages/shell/ios/AppModule.swift`.
- Engine: `engine/ardiacore/src/ardia/core/ac_navigation_routing.{h,mm}` (matcher, routed opens, new-window handler, redirect throttle), `ac_browser.mm` (delegate), `ac_main_delegate.cc` (creation seed, throttle registration), `ac_content_hooks.h`, `ac_seams.mm`, `renderer/ac_content_renderer_client.cc`.
- Chromium patches, listed in `engine/patches/series`: `chromium-renderer-navigation-forwarding.patch`, `chromium-new-window-routing-hook.patch`, `chromium-open-url-form-download.patch`.

## Arc measurements

Arc 1.169.0, with neutral URLs on local test pages. Space A and Space B use different Arc profiles; Space C shares A's profile. Results show where the tab landed, not which cookies Arc sent. The labels are the ones cited above.

| Case | Arc result | Label |
| --- | --- | --- |
| Link from another app matching B while A is selected, then the same URL again | New foreground tab in B and Arc switches to B; the repeat opens another tab | E1, E2 |
| External URL matching only in its path, query or fragment, or in another case | Routes | E13, E16, E17 |
| ⌘L in B or ⌘T in A, URL matching the other Space | New foreground tab there; the source tab keeps its URL | E3, E4 |
| ⌘L with no match, or ⌘L or a link matching the current Space | Same tab navigates; tab count unchanged | E5, E15, E19 |
| Link or `target=_blank` matching another Space | Foreground tab there; source kept | E14, G5, E8 |
| ⌘-click matching another Space | Background tab there; source Space stays selected | E7 |
| Button sets `location.href` to a matching URL | Foreground tab in B; source kept | G9 |
| Delayed `location.href` on a fresh page with no user activation | Foreground tab in B; source kept | G11 |
| `window.open` after a click, or `_blank rel=opener`, from A matching B | Foreground tab in B; `opener` is null | G10, G6 |
| Link, or `_blank rel=opener`, from A matching C, which shares A's profile | Foreground tab in C; source kept; `opener` present with `rel=opener` | G27, G28 |
| Matching GET or POST form | Same tab; query or body kept | G4, G3 |
| Fragment-only link `href="#…"` containing the rule text | Same tab | F5 |
| No-match URL that 302s to a matching URL on the same origin, another port, or another host | Same tab | E12, H2, H3 |
| `location.replace` to a matching URL on the same or another host, or `location.href` set before the page finishes loading | Same tab | H5, H6, H9 |
| Direct link to a matching URL on that other host | Foreground tab in B; source kept | H7 |
| No-match link from a page with beforeunload | Leave-site dialog; Cancel keeps the source | G7 |
| Link from that page matching another Space | Destination opens at once; no dialog; source unchanged and still armed | G8 |
| Matching link from a pinned tab | Routes at once; pin kept; no Peek | F4 |
| No-match cross-site link from a pinned tab | Peek; promoting it opens a tab in A | F3, E21 |
| Open Link in Little Arc on a URL matching another Space | Little Arc uses source A; Open in A moves it to A | E10 |

| Case | Arc result | Label |
| --- | --- | --- |
| New Route and the editor | Adds one row: Contains or Is equal to, text, destination (a Space, Most Recent Space or Little Arc). No AND/OR, multiple conditions, Save/Apply or reorder; edits survive reopening | G1 |
| `alpha` → B listed before `beta` → A; URL has `beta` before `alpha` | First listed rule wins (B) | G2, E18 |
| `alpha` → Little Arc; ⌘T in B, or a link in A | Little Arc window for the source Space; no main-window tab; source kept | G12, G13 |
| Default Little Arc; link or ⌘L in A matching `alpha` → Most Recent, or matching nothing | Same tab navigates | G14–G16 |
| Default set to Little Arc, then back to Most Recent | Arc's toggle for opening external links in Little Arc follows it | G16 |
| Is equal to `http://host:port/ATCResearchEqual`; exact URL, lowercase path, trailing slash, `https`, added `?q=1` or `#frag` | Match | G17–G20, G22, G23 |
| Same rule; `/ATCResearchEqualExtra` or `/%41TCResearchEqual` | No match | G21, G24 |
| Rule `…/ATCResearchEqual?q=1#frag`; that URL or the bare path | Both match | G25, G26 |
| C deleted while a rule and the default point at it | Rule kept with a blank destination; default blank | G29 |
| Deleted default and orphan rule; external URL matching nothing or the orphan rule | Foreground tab in the most recent Space: A, or B when B was most recent | G30, G31, G33 |
| Orphan rule kept, default set to B; URL matching the orphan rule | Tab in B; the orphan rule doesn't block the default | G32 |

Arc's help says routes to deleted Spaces are removed ([Air Traffic Control](https://resources.arc.net/hc/en-us/articles/22932014625431-Air-Traffic-Control-Automate-Your-Link-Routing)); 1.169.0 kept them (G29), and ATC follows the measurement. Arc lists ATC settings as local-only ([Arc Sync](https://resources.arc.net/hc/en-us/articles/20272860828823-Arc-Sync)).

Not measured in Arc: private windows, `window.open` without a gesture, Unicode, IDN and percent-encoding variants of Contains, cold launch, mixed batches from other apps, several windows, reversed rule order, every default and destination combination, Shift-click with a physical keyboard, and which cookies a routed request carried.

## How it was checked

- The engine was built from Chromium 155.0.8059.84 with the patch series; each new patch applies and reverses cleanly on the pinned sources. The existing typecheck, unit tests (browser, core, sync, import), ArdiaCore C++ tests and native acceptance checks passed (one screenshot check run with an sRGB color profile, one event check run on its own).
- Runtime checks used a local test site with two profiles on separate cookie stores and a third profile sharing the first one's store. The server log, not the sidebar, showed which cookies each request carried.
  - Rules: Contains across URL parts and case, first match, the equality cases, a blank row, edits applying to the next request and surviving restart, orphan rules, and the Most Recent fallback.
  - Routed links and ⌘L opened the destination and left the source's URL and history alone; ⌘-click kept the source selected. Same-profile matches navigated in place. A pinned source stayed.
  - A routed first request carried only the destination's cookie and had no opener. A `rel=opener` route between profiles sharing a store kept the opener and the shared cookie.
  - GET and POST forms, fragment links, a redirect within the test site to a matching URL and a `download` link stayed in the source. `location.replace` and an early `location.href` stayed in the tab, and `location.replace` replaced the history entry. An assignment after load routed.
  - With beforeunload armed, a routed navigation didn't prompt or touch the source. An unmatched link, or a matching `location.replace`, prompted, and Cancel kept the source.
  - Little Ardia routes used the source profile and kept background intent. A routed popup kept its 500×400 size. Private windows stayed private.
  - Cold launch: a mixed batch honored each decision, a repeated URL opened twice, preloads used the right cookies, and a destination started before JS hydrated was adopted once without a second request. Missing or expired adoption tokens closed the view without a request, and a held launch destination past its time limit was discarded, not replayed. Closing a source after handoff left the destination open.
- By hand on google.com: a search for a rule's text stayed in the source profile, including its `location.replace` step. Clicking the matching result opened it in the destination profile, selected, and left the results page in place.
- Reviewed in source but not induced: a failed profile load; Stop, close or document replacement while waiting for a profile; destination deletion or remapping during a pending open; incompatible adoption tokens; source destruction during the fullscreen check. Physical modifier keys and real macOS full-screen Space transitions weren't checked.
