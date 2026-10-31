# Air Traffic Control

Arc's Air Traffic Control, for Ardia: routes that choose where a link opens. Settings › Links holds them; issue #26.

## Routes

A route is one condition and one destination. The condition is `URL Contains <pattern>` or `URL Is equal to <pattern>`:

- **Contains** is a case-insensitive substring match on the whole URL, path, query and fragment included, so `github.com`
  matches `https://github.com/mantrakp04/ardia` and `https://example.com/?next=https://github.com/x`.
- **Is equal to** compares the URL and the pattern without their scheme, query, fragment, case and one trailing slash:
  `linear.app/team` equals `https://Linear.app/team/?utm=1#top` and not `https://linear.app/team/issue-1` or
  `www.linear.app/team`. Nothing else is normalized (ports, `www.`, percent escapes, IDN).
- Only `http(s)` URLs match. A route with a blank pattern never matches.

The destination is a profile, one of its tab groups, Most Recent Profile (the profile of the main window used last) or
Little Ardia. Routes run from the top; the first match wins. A route whose profile or group no longer exists is skipped,
and the next matching route or the default takes over. New Route adds a route; ⊖ removes it; the row's context menu moves
it up or down. Changes apply at once.

Below the routes, **Open links from other apps in** is the default for links from other apps with no match, with the same
destinations. It replaced the Little Ardia / A new tab switch: a saved "A new tab" became Most Recent Profile, and Little
Ardia stays the default on a fresh install. Settings › General shows the same default, and File › "Open Links from Other
Apps in Main Window / Little Ardia" switches it between Most Recent Profile and Little Ardia.

Routes stay on this Mac. Arc keeps them local too.

## What routes

| Link | With a match for another destination | Without one |
| --- | --- | --- |
| From another app (Discord, Slack, Mail, `open`) | The destination: a foreground tab in that profile's main window (the frontmost one, paged to the profile, or a new window), in the group, or a Little Ardia window | The default destination |
| Typed into the address bar or the new tab bar | A foreground tab at the destination, the source tab untouched (Arc opens a new tab there too); ⇧↩ opens a window there | Navigates as before |
| Clicked on a page: a plain click, ⌘-click or ⇧-click on an `http(s)` link | Foreground tab, background tab (⌘) or window (⇧) at the destination; the source page stays where it is | Chrome's own handling |

A match for the profile you are already in is not a route: the link opens as it always did, referrer and all. A tab group
route in the current profile is a route (into the group), and so is Little Ardia, which keeps the source profile for a
typed URL or a page click and uses Most Recent Profile for a link from another app.

Private windows never route, and nothing routes into one.

### Page clicks: how, and what stays Chrome's

The page script (`packages/ardiacore/ios/page_script.js`, the one that already handles Peek and Split clicks) receives
the routes and the tab's profile with its config, and native pushes new routes to every open page. A trusted click on a
link whose URL matches a route for another destination is prevented in the page before Chrome starts a navigation, and
the page posts `route` with the URL and how to open it. Native accepts it only against the last real mouse-up over that
page, the same check Peek uses, so a page can't synthesize one, takes the disposition from that mouse-up's own keys
(none: a foreground tab; ⌘: a background tab; ⇧: a window; ⌘⇧: a foreground tab, as Chrome; anything else, or the
Peek or Split key: nothing), and emits `openWindow` with `routed` and whether the link opens a tab (`target=_blank`)
or the page; JS places it (`openFromPage` › `openRoutedLink`). A link clicked where it already is (a tab inside the
destination group, a Little Ardia window for a Little Ardia route) is not a route. If the routes changed in between and
the link no longer routes, JS performs the click's own open instead: a navigation, or a tab for `target=_blank`.

Not routed, by design: a click the page itself prevented (SPA routers), links with `download`, clicks with the Peek or
Split modifier, ⌥-, ⌃- and middle clicks and links activated from the keyboard (native checks gestures against the left mouse-up only), links whose
`target` names a frame, links inside frames unless they open a tab or the whole page, URLs over 8192 characters (native
would cut them), pages on the WebKit engine (they run WebKit's page script), forms, `location.href` assignments and other script navigations, `window.open`, and
redirects. A matching route beats the tab's Peek links to other sites: the click routes instead of peeking. A ⇧-click or ⇧↩ to a group route opens a new window, where only a pinned group has a copy; an unpinned
group's route opens the tab ungrouped there. Routing those needs hooks in Chrome's navigation code before the request starts (PR #87 added three Chromium
patches and an engine-side matcher for it); this version stays in the app so it runs on the prebuilt engine.

## Cold launch

When a link from another app launches Ardia, native parks it in the last profile before JS runs (`ArdiaCoreHost.mm`).
With routes saved, it parks a link only if no route matches it (the same Contains and Is equal to rules, on the same URL text) and the default
destination uses the most recent profile (Most Recent Profile or Little Ardia), and it shows the early Little Ardia window
only when the default is Little Ardia, so a link that may route never makes a request with the wrong profile's cookies.
Those links wait for JS and route normally.

## Code

- `apps/browser/src/lib/linkRouting.ts`: the model, normalization, matching and placement, pure; `linkRouting.test.mjs`.
- `apps/browser/src/state/linkRouting/`: placement against the store (profiles, groups, parked pins, the recent profile,
  the tab or window the link comes from), the routes handed to pages, opening at a destination, typed URLs, and the
  pane's hooks. `state/littleArdia/actions.ts`: links from other apps. `state/tabs/openFromPage.ts`: page clicks.
- `apps/browser/src/components/settings/panes/Links.tsx`: the pane. `state/settings/settings.ts`: `linkRouting` and `sessionWithLinkRouting`, session migration 9 → 10 (`state/session/persist.ts`).
- `packages/ardiacore/ios/ArdiaWebView+Peek.mm`: `setLinkRoutes`, the `route` message and its gesture check;
  `ArdiaWebView+PageMessages.mm`: the routes in the page's config; `ArdiaWebView.mm`: the `sidebarProfile` prop;
  `ArdiaHost+Launch.mm`: cold launch; `page_script.js`: the click interceptor. Native API 21.
