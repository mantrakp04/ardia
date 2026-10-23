# Air Traffic Control for Ardia

Status: implementation, Chromium build, local app build, and bounded runtime acceptance completed through 2026-10-24. The Google result-click correction is included: eligible user-activated cross-site redirects can route before the destination request, retaining the Personal search. The owner tested the rebuilt app and reported it working; the subsequent readback confirmed the Personal Google search and selected Rythm destination tabs. Pinned Chromium: `155.0.8059.84`; validated base: `fce1abe1`. This document describes the final architecture, measured reference behavior, validation, and remaining limits. Historical follow-up sections retain the earlier decisions and explicitly identify the superseding correction. This is a draft contribution, not a release or exhaustive Arc-parity claim.

## Design decision

Use one browser-process native matcher, TypeScript settings in the existing store, and Ardia's existing profile loading, window selection, tab creation, and adoption mechanisms. Match before the routed navigation loads. Preserve exact sidebar identity separately from the engine profile that owns cookies. A cross-Space route preserves the source page and creates a destination; same-Space ordinary navigation continues in place. Preserve background intent.

Two narrow Chromium seams cover the missing native entry points: forward eligible renderer navigation through the existing `OpenURL` path before warmup and beforeunload, and intercept new-window creation after Chromium's security checks but before choosing a browser context. A redirect-only throttle handles tagged user-activated current-tab requests that continued through the stock delegate. Native destination loads do not reenter the renderer forwarding path and remain untagged; no loop marker, URL cache, or generic replay framework is needed.

Rules and the external default share three destination choices: a specific Space, Most Recent Space, or Little Ardia. Rules apply to typed URLs, external opens, ordinary links, and eligible script navigation. Forms and current-tab replacement navigations retain their existing behavior. The default applies to external opens; it does not redirect unmatched ordinary browsing.

“Space” means Arc's sidebar workspace; its Ardia counterpart is a sidebar profile ID. This is not an engine profile: multiple sidebar profiles can share one engine through `shareWith`/`sharedDataIds`. Use both identities explicitly throughout the contract.

## Evidence and expected behavior

Live evidence comes from Arc 1.169.0 on 2026-10-23, using neutral example.com URLs and disposable local fixtures. `E1`–`E21` and `F1`–`F5` are UI readbacks/screenshots in investigation `ARC-ATC-LIVE-20261023`, conversation `01a1668e-6d74-7931-95b1-c027ba02b451`. `G` labels are from `ARC-ATC-SPEC-20261023`, conversation `01a166b7-c4e1-7e91-a5bf-2da808c4212b`. These references identify worker evidence, not files in the checkout. Native source research is `ARC-ATC-NATIVE-20261023`, conversation `01a166b8-a35b-7060-b380-5364c2735a67`.

The original four Contains rules, in order, were `rythmfm → Rythm`, `rythm → Rythm`, `maps.google.com → Personal`, and `photos.google.com → Personal`; default Most Recent Space. External Little Arc was off, option-command Little Arc on, Shift-click Peek on, and cross-site pinned/Favorite Peek on. The second investigation added temporary distinctive rules and changed the default for controlled comparisons. Final screenshot/accessibility verification restored exactly the four original rows/order, Most Recent default, external Little off, option-command Little on, Shift Peek on, pinned/Favorite Peek on, and six-hour Little archive setting. All owned rules, three disposable Spaces, source/destination tabs, two Little windows, Finder window, `.webloc` files, and fixture directories were removed; both fixture servers stopped and ports 48173/48174 were verified closed. Existing Spaces/tabs/pins and concurrent user navigation were preserved. Neither live Arc investigator edited repository files or read browser profile files; implementation and validation followed separately.

### Routing and source preservation

P denotes Personal; R denotes Rythm. Their engine profiles differ.

| Input | Observed result | Evidence |
| --- | --- | --- |
| External matching URL from P | New foreground R tab and Space switch | E1 |
| Repeat identical external URL | Another tab; no URL reuse | E2 |
| Cmd-L in R, matching P | New foreground P tab; source R URL/tab preserved | E3 |
| Cmd-T in P, matching R | Foreground R tab | E4 |
| Cmd-L unmatched | Existing same-tab navigation | E5 |
| Ordinary matching cross-Space link | Foreground destination tab; source preserved | E14, G5 |
| Cmd-click matching cross-Space link | Background destination; source Space remains selected | E7 |
| `target=_blank` matching cross-Space link | Foreground destination; source preserved | E8 |
| Same-Space matching Cmd-L or ordinary link | Navigates existing tab; count unchanged | E15, E19 |
| Unmatched initial URL, same-origin HTTP 302 to matching final URL | Same source tab/Space; no redirect-stage rerouting in this case | E12 |
| External URL with matching path/query/fragment | Routes using those URL components | E1, E16, E17 |
| Literal same-document `href="#rythm"` | Same Personal tab; no routing | F5 |
| Matching GET form | Same source tab; query preserved | G4 |
| Matching POST form | Same source tab; `payload=neutral-post` preserved | G3 |
| Button `location.href` to matching URL | New foreground R tab; source preserved | G9 |
| Delayed `location.href`, fresh fixture with no page activation | New foreground R tab; source preserved | G11 |
| Activated `window.open` matching URL | New foreground R tab; destination reports `opener: null` | G10 |
| Matching `_blank rel=opener`, P → R | New foreground R tab; destination reports `opener: null` | G6 |
| Ordinary link to a different Space sharing Personal engine profile | New foreground destination-Space tab; source preserved | G27 |
| Matching `_blank rel=opener` to that shared-profile Space | New foreground destination-Space tab; destination reports `opener: present` | G28 |
| Unmatched link from source with armed beforeunload | Leave-site dialog; Cancel keeps source | G7 |
| Matching cross-Space link from same armed source | Destination opens immediately; no dialog; source still armed and at original URL | G8 |
| Matching pinned-source cross-Space link | Routes immediately, preserves pin, bypasses Peek | F4 |
| Unmatched pinned-source cross-site control | Actual Peek; unmatched Peek promotion opens P tab | F3, E21 |
| Explicit Open Link in Little Arc, matching another Space | Little uses source P; Open in Personal promotes to P | E10 |

The initial E6 destination stalled because of a single-threaded fixture; later successful controls establish page loading. The second investigation used a threaded server to avoid confusing preconnections with routing failures. Address bars are evidence of placement, not cookie identity.

### Editor, destinations, and matching

| Comparison | Observed result | Evidence |
| --- | --- | --- |
| New Route | Appends one independent condition/destination row; Contains or Is equal to | G1 |
| Editor controls | No AND/OR, multiple-condition, save/apply, or reorder control visible; edits survive closing/reopening | G1 |
| Rule destination menu | Specific Space, Most Recent Space, and Little Arc | G1 |
| Earlier alpha → R, later beta → P; URL contains beta before alpha | Earlier displayed alpha rule wins | G2; corroborates E18 |
| Lowercase Contains rule, external uppercase ASCII pattern | Matches | E13 |
| alpha → Little, default Most Recent; Cmd-T from R | Separate Little Arc, Open in Rythm; no main destination tab | G12 |
| Same rule, ordinary link from P | Separate Little Arc, Open in Personal; source preserved | G13 |
| alpha → Most Recent, default Little; ordinary link or Cmd-L from P | Same P tab navigation | G14, G15 |
| Unmatched ordinary link under default Little | Same P tab navigation | G16 |
| Default switched to Little / restored to Most Recent | Parent external-Little toggle changes with it / returns off | G16 follow-up |
| Equality rule `http://127.0.0.1:48173/ATCResearchEqual`; exact URL | Matches | G17 |
| Same equality rule; lowercase path | Matches | G18 |
| Same equality rule; added terminal slash | Matches | G19 |
| Same equality rule; HTTPS instead of HTTP | Routes before expected TLS failure at HTTP-only fixture | G20 |
| Same equality rule; `/ATCResearchEqualExtra` | No match; same Personal tab | G21 |
| Same equality rule; `/ATCResearchEqual?q=1` or `/ATCResearchEqual#frag` | Matches | G22, G23 |
| Same equality rule; `/%41TCResearchEqual` | No match; fixture confirmed literal percent encoding | G24 |
| Equality rule changed to `http://127.0.0.1:48173/ATCResearchEqual?q=1#frag`; exact and bare `/ATCResearchEqual` inputs | Both match; query/fragment ignored on both sides | G25, G26 |

The shared-profile control used an owned Space named ATC Research G Shared, visibly configured with Arc Profile Personal. G27/G28 distinguish sidebar placement from engine identity and establish opener preservation when the engine is shared. G29 then deleted that empty owned Space while its rule/default referenced it: the Space disappeared immediately, but ATC retained the rule with a blank destination selector and displayed a blank default selector. Both accessibility and screenshot readbacks confirmed this.

| Deleted-target comparison | Observed result | Evidence |
| --- | --- | --- |
| Deleted fixed default and orphan rule both blank; Personal most recent; unmatched external URL | New foreground Personal tab | G30 |
| Same state; external URL matching the orphan rule | New foreground Personal tab | G31 |
| Orphan rule still blank, default explicitly Rythm; matching external URL | New foreground Rythm tab; orphan rule does not block default | G32 |
| Another deleted fixed default blank; Rythm explicitly selected as most recent; unmatched external URL | New foreground Rythm tab; together with G30 supports Most Recent fallback | G33 |

These external trials used native Finder Open With Arc on owned `.webloc` fixtures. One G32 attempt was interrupted by concurrent user navigation and produced no fixture request; it was retried once, and the user's navigation was preserved. G30/G33 distinguish a recent-Space fallback from a fixed Personal fallback.

Arc's [ATC documentation](https://resources.arc.net/hc/en-us/articles/22932014625431-Air-Traffic-Control-Automate-Your-Link-Routing) documents the Open Link Preferences command and claims routes to deleted Spaces are removed. G29 contradicts immediate pruning in the observed version; use the live result. Its [sync documentation](https://resources.arc.net/hc/en-us/articles/20272860828823-Arc-Sync) lists ATC settings as local-only. Live measurements also take precedence over generic wording about “exact” matching.

### Boundaries of the evidence

Automated accessibility and coordinate Shift-click both opened full windows, not Peek, despite the preference. Physical keyboard behavior remains unverified; preserve existing disposition handling rather than introducing a new Shift policy. Ardia does not currently implement webpage Peek in `openFromPage`; adding the whole Peek feature is outside this change. ATC must reproduce the measured matching cross-Space precedence, which bypasses Peek.

Private/incognito routing, no-gesture `window.open`, exhaustive Unicode/IDN/Contains-encoding combinations, cold-launch Arc behavior, mixed external batches, and multiple existing Arc windows remain unmeasured. The full fixed/Little external-default matrix and reversed displayed-order/specificity comparisons were not exercised; ordered first match is supported by G2 and E18. Arc cookie identity/first-request credentials were not inferred from UI placement. Preserve Ardia's existing isolation and window behavior where specified below. These limits do not require another routing architecture, but they prohibit a claim of exhaustive Arc parity. The implementation acceptance matrix separately covers Ardia's cold launch, batches, profile identity, and native restrictions.

## Settings, matcher, and synchronization

### Persisted model

Use one local settings value, following the existing TypeScript store conventions:

```ts
type LinkDestination =
  | { kind: "little" }
  | { kind: "recent" }
  | { kind: "profile"; profileId: string };

type LinkRule = {
  id: string;
  match: "contains" | "equals";
  text: string;
  destination: LinkDestination;
};

type LinkRouting = {
  rules: LinkRule[];
  defaultDestination: LinkDestination;
};
```

Use stable sidebar IDs, not names or engine IDs. Ordered array position is rule precedence. One row has one condition. Do not add a condition AST, regex/glob syntax, numeric priority, enabled flags, drag ordering, import/export, simulator, or telemetry subsystem.

Replace `openLinksInLittleArdia` directly with `linkRouting.defaultDestination`; update every reader/writer, including General, commands, menus, and early native startup. No dual representation or compatibility layer. Missing new settings use an empty rule list and Little Ardia default, matching the fresh-install behavior. Under this explicit direct cutover, an old saved `false` boolean alone does not preserve Most Recent as the new default. Remove obsolete `chosen`/`inferred` entries for the deleted key without adding a legacy reader.

Incomplete editor rows remain editable but are omitted from the installed matcher. Normalize hydrated data, reject malformed shapes/operators, and never let an empty condition become match-all. Retain a well-formed fixed destination ID after its sidebar is deleted, rendering its selector blank without silently selecting another value; G29 shows that the row and default selection are not immediately pruned. Missing targets are not executable identities. Distinguish that unresolved reference from corrupt data and from an in-flight destination deleted after acceptance. Omit rules with unresolved targets from the executable snapshot and continue normal matching/default resolution, as G31/G32 establish. Keep the visible orphan row editable. An unresolved fixed default uses Most Recent at runtime, supported by G30/G33; retain the persisted unresolved ID and blank selector until the user chooses a valid replacement. This is normal policy resolution before a request starts, distinct from a deleted/changed destination canceling an already-accepted operation. Keep all ATC settings outside the sync allowlist.

### Native matching and opening policy

Implement one small flat native matcher near ArdiaCore navigation code, optionally in `ac_navigation_routing.h/.mm` if that keeps `ac_browser.mm` readable. It returns the first matching destination or no match. Eligibility and action selection remain separate from string comparison; do not mirror the matcher in TypeScript or renderer processes.

Contains performs a literal ASCII-case-insensitive substring comparison over the supplied resolved URL, including path/query/fragment. Equality compares the whole normalized string: lowercase ASCII; remove a leading HTTP(S) scheme; remove query and fragment; remove one optional terminal slash. Apply that same normalization to the URL and rule text. Compare full resulting strings, so `/ATCResearchEqualExtra` differs and `%41` is not decoded to `A`. Keep the port and remaining host/path text. This is the smallest normalization consistent with G17–G26; additional `www`, default-port, Unicode/IDN, repeated-slash, and other percent-encoding equivalences are not claimed.

Use the resolved URL supplied by the existing navigation path (native GURL serialization where that is the native input), without an additional decode or rewrite. Keep rule text as text; Contains rules are arbitrary substrings, and parsing every rule as a GURL would reject valid conditions or add unmeasured equivalences. Typed input goes through the existing omnibox resolver first; the matcher never receives raw search text. Do not add a second parser in TypeScript or an interface to recover hypothetical pre-canonicalized renderer URLs.

Resolve a selected destination once per operation. A fixed destination supplies its exact sidebar ID; Most Recent uses the current regular-sidebar selection; Little uses the source sidebar/engine for internal requests and the recent regular sidebar/engine for external requests. The internal-source Little behavior is measured; the external identity choice reuses existing Ardia behavior.

| Origin and result | Opening action |
| --- | --- |
| Ordinary navigation, no match | Existing operation; never apply external default |
| Ordinary navigation, same-sidebar fixed/recent match | Existing same-tab operation |
| Ordinary navigation, different-sidebar fixed/recent match | Preserve source; new foreground destination tab |
| Matching new-tab/background request | Destination tab with original foreground/background intent |
| Matching Little rule | Separate Little window using resolved source/recent identity; source preserved |
| External request, match | Use rule action; each occurrence is an independent open |
| External request, no match | Use configured external default |
| Explicit Little command or promotion into a named Space | Use explicit destination; no automatic rematching |

Keep no-match distinct from a same-sidebar match, and both distinct from an error. Preserve new-window intent through existing disposition handling. For a foreground internal cross-Space route, place it in the originating main window where possible, matching the observed single-window case. External/multiple-window placement reuses `mainWindowFor` and existing focus helpers; do not add a second window-selection policy.

### One native snapshot

Publish rules, default, sidebar-to-engine mapping, and most recent eligible sidebar as a compact immutable snapshot on the native UI sequence. Derive engine IDs using existing shared-data mapping, including the default engine's empty-string convention. Associate each native owned tab with its exact sidebar ID and update that ID when UI ownership changes; never infer ownership by finding the first matching engine profile.

Extend existing `lib/linkRoutes.ts` to install/subscribe the snapshot from `startNativeSync`. Persistence hydration already precedes this setup. Export setter/resolver through existing Expo bindings with `.runOnQueue(.main)`. Await the initial install before registering `onOpenURLs`; the existing shell inbox retains pending URLs until the listener is attached. Queue subsequent store snapshot installs on the same sequence, and have typed/external resolvers await the latest installation promise. Native webpage entry points read the current installed snapshot locally. Do not add locks, generations for configuration, a renderer snapshot, or a second inbox.

For cold launch, read the existing session before early link loading. Persist one derived `linkProfileId = lastActiveProfile(s)` hint alongside existing session profiles, replacing the old engine-only `linkProfile`. Derive its engine from `session.profiles[].dataId`, not another persisted map. Keep the hint independent of the speculative-preload kill switch: policy resolution is required even when preloading is off. Once live configuration is installed, use it for warm arrivals rather than rereading the debounced session file.

## Entry points and request ownership

### External and startup links

Replace the batch-wide `routeLinkTabs` contract with one ordered result per input: exact sidebar ID, resolved action, original input occurrence, optional existing adoption token, and dismissal state. Engine identity remains native except where existing native creation APIs require it. Keep dismissed/filter indices aligned. The same URL appearing twice represents two requests, not one cached result.

Resolve before `TryEarlyLittleWindow`, `ParkLaunchLinks`, or `StartParkedPage` can start that URL. Replace `gLinkProfile` as a batch assumption. Retain the current preload bound and claim/dismissal mechanics. If the chosen engine is not loaded, skip that speculative preload; later use the normal `WithProfile` destination path. Never substitute a loaded source/recent engine to save startup time.

A page already preloaded carries its captured action/sidebar/engine through the existing `link:` adoption handoff. Hydration must not reroute that page. Unstarted inputs use the current snapshot. Consume mixed results individually through existing Little/main-window helpers, in input order, without a new batch scheduler. The existing single-input Little optimization must not silently turn a matched Little action into a main tab because another URL arrived in the same batch; the exact Arc batch focus order remains unmeasured.

A seeded preload may itself start an eligible routed navigation before its source WebView exists. Its existing launch holder retains the resulting native tab and frozen placement until the source attaches, then hands it off once through the ordinary routed popup/tab path. Use a bounded lease and dispose only still-held contents on expiry, source dismissal, or failed adoption. Host-driven close must explicitly drain this ownership because it can suppress `tabWillClose`. Once transferred to popup or offered-tab ownership, the destination is independent of subsequent source closure. Do not close a valid destination merely because the source view has not mounted, use another tab as its source, or recreate its URL later.

Preserve existing admission for script URLs, internal URLs, file URLs, and custom protocols. Automatic ATC matching is HTTP(S); other schemes retain current handlers and `allowJavaScriptFromAppleEvents` checks. Remove the promise-rejection fallback that opens URLs in a guessed recent profile. Only a successful no-match result invokes the configured default; a resolution/profile failure uses existing failure handling and makes no request with an uncertain identity.

### Typed navigation

Resolve after normal omnibox input resolution and before `openFromBar`/`openFromNewTabBar` changes tabs, groups, or blank-tab ownership. `store.navigate` starts the native request before publishing state, so routing after it is too late.

No match or same-sidebar normal action follows the existing implementation. Cross-sidebar or Little action creates only the destination and preserves the source/group. Revalidate the originating window/tab and current command after an asynchronous resolution; a superseded command or closed owner cannot open a late destination. Reuse existing owner identity and a bounded command completion guard, not a persistent command queue.

Validate the destination at the JavaScript handoff as well. Typed and unstarted external results carry their captured engine identity alongside the exact sidebar ID so the caller can reject a deleted sidebar or changed shared-data mapping before mutating the source UI or calling existing creation helpers. Those helpers normally substitute a default for an unknown profile; an accepted ATC decision must never reach that fallback. Started native placement already carries its engine identity and remains subject to required-adoption validation. Modified open-tab suggestions that open a new tab/window use the same typed routing entry; current-disposition switching to an existing tab remains an explicit switch. Little-window placement carries original background intent into the existing window-creation helper.

The resulting browser/controller load is already an explicit native operation and does not call renderer `BeginNavigation`. It needs placement metadata, not a routing-bypass bit. Generic store navigation for restoration, history, and internal commands is not an ATC entry point.

### Eligible renderer navigation before beforeunload

The measured target includes main-frame non-form HTTP(S) GET navigation from links and scripts, including scripts without user activation. Current-tab replacement navigation bypasses ATC matching, as the H5/H6/H9 follow-up establishes. Preserve native form GET/POST, reload/back-forward/restore, same-document navigation, subframes, downloads, non-HTTP schemes, and private contexts on their existing paths. Private routing is an explicit unmeasured boundary, never a fallback into a regular engine. Popup permission remains Chromium's decision.

Add a null-default content seam using the repository's existing `g_ardia_*` pattern:

```cpp
bool (*g_ardia_open_navigation_in_browser)(
    content::RenderFrame*,
    const blink::WebNavigationInfo&);
```

Declare in `ac_content_hooks.h`, define in Chromium `render_frame_impl.cc`, and register the predicate in `ACContentRendererClient`, not browser-process `ac_seams.mm`. At `RenderFrameImpl::BeginNavigation`'s existing `browser_handles_all_top_level_requests` branch, OR the narrow predicate into the existing forwarding condition. A true result executes the existing `OpenURL(std::move(info)); return;`.

The predicate admits outermost-main-frame CURRENT_TAB HTTP(S) GET with ordinary standard or replace-current load type, excluding native form/body, reload/history/restore, and download intent. Do not require a hyperlink marker or user gesture. Put it beside the early branch at pinned line 5749, before speculative warmup at 5824 and before renderer beforeunload at 5858. Keep the broad preference unchanged; globally enabling it would forward forms/history/reloads through a path that does not retain all their semantics.

The existing one-way chain is renderer `OpenURL` → validated RFH `OpenURL` → `Navigator::RequestOpenURL` → `ACWebContentsDelegate::OpenURLFromTab`. Extend the delegate to handle forwarded CURRENT_TAB as well as Cmd/new-tab requests. It matches in the browser process with the source's exact sidebar identity.

For no match or same-sidebar ordinary action, invoke the stock `BrowserWebContentsDelegate::OpenURLFromTab` with the original parameters. That native navigation enters `Navigator::Navigate`, which runs source/descendant beforeunload and preserves Cancel behavior. For a cross-sidebar or Little result, do not navigate the source: copy the native request, post the owned destination operation, and consume the original. Source history/document remain intact, and its beforeunload is not fired. A routing throttle cannot implement this distinction because its `WillStartRequest` runs after the source's renderer beforeunload.

In `RouteOpenURL`, return to the stock delegate before matching when CURRENT_TAB has `should_replace_current_entry`. Keep the renderer forwarding predicate unchanged so native replacement intent reaches the browser. This preserves replacement history and the stock beforeunload path, while post-load `location.href` assignments still route. Do not broaden this into an origin, gesture, or script exclusion.

Literal fragment-only navigation completes in Blink before this seam. For eligible user-activated CURRENT_TAB requests with no match or a same-sidebar result, wrap the stock navigation-handle callback to attach the original request metadata, weak source, accepted host/sidebar owner, source `WeakDocumentPtr`, and committed origin. Attach before invoking the original callback exactly once, and do not access the handle afterward. Exclude private contexts and missing sidebar identity. Register the redirect throttle independently of this tag because the callback runs after native navigation creation; inspect the tag lazily in `WillRedirectRequest`.

At a cross-site HTTP(S) redirect, compare `SchemefulSite` with the captured source origin. Same-site hops continue normally. Revalidate the source contents, original host/sidebar ownership, and original primary document before matching. Invalidated ownership or a resolution error cancels without fallback. No match or a same-sidebar result continues; a cross-sidebar/Little result consumes the tag once, copies the original request with only the current URL, referrer, and redirect chain updated, and posts the existing native routed-open operation before returning `CANCEL_AND_IGNORE`. The pending operation checks the captured document again after profile readiness. A request that becomes POST or non-primary is untagged and continues stock. Preserve the original download policy, ad state, initiator metadata, and gesture. This policy intentionally expands beyond the earlier reference fixture behavior to handle opaque result links in the actual Google flow.

Redirects in already-routed destination loads remain native and untagged. `LoadURLWithParams` creates its request through controller/`Navigator::Navigate`, even when `is_renderer_initiated` is true; that flag records origin and does not reenter renderer `BeginNavigation`. New-tab redirect intermediaries are outside this bounded correction.

### Preserve native request metadata

Copy `content::OpenURLParams` in native code, retaining referrer/policy, initiator origin/frame/process/state, source SiteInstance, headers, transition, gesture, replacement intent, ad information, and disposition. Do not serialize requests through JavaScript or reconstruct them from URL-only events.

Plumb only the missing fields required by the newly forwarded paths: `is_form_submission` and `blink::NavigationDownloadPolicy`. Both already exist in the OpenURL Mojo message. Populate the renderer's currently unset form field from native request/form information; pass both through the RFH call and `Navigator::RequestOpenURL` into public `OpenURLParams` and `NavigateParams`. Copy them in `FillNavigateParamsFromOpenURLParams`, `LoadURLParamsFromNavigateParams`, and the `LoadURLParams(OpenURLParams)` constructor. `LoadURLParams` already has both fields. No new Mojo schema or hyperlink-origin flag is necessary. This prevents GET forms being misclassified on alternate OpenURL paths and preserves download restrictions for ordinary/script GET responses.

To open a routed destination, construct `NavigateParams` for the destination Browser and fill it from the copied native parameters. Set the real live source contents, reset `frame_tree_node_id` for a new target, convert CURRENT_TAB to foreground only when a separate destination is needed, and set `window_action = kNoAction`. Disable PWA capture for this explicitly selected destination with existing `web_app_navigation_data.SetNavigationCapturingForceOff(true)` so capture cannot choose another browser. Preserve original background intent separately, because Chrome normalizes a first background tab in an empty Browser to foreground internally.

Let Chrome perform its existing cross-profile scrub: it clears opener, source contents/SiteInstance, and referrer when source/target profiles differ, while retaining initiator metadata. Do not install a foreign SiteInstance or DOM opener, or erase initiator information to make a request work. UI source ownership travels separately in the pending placement metadata. G6/G10 establish null opener for measured cross-engine opens; G28 establishes a present opener across Spaces sharing the engine. Preserve both distinctions.

### New-window creation before choosing browser context

Add one pre-creation seam to `WebContentsImpl::CreateNewWindow`:

```cpp
using ArdiaConsumeNewWindow = base::OnceCallback<void(
    blink::mojom::WindowFeatures,
    base::ScopedClosureRunner)>;

ArdiaConsumeNewWindow (*g_ardia_route_new_window)(
    content::WebContents* source,
    content::RenderFrameHost* opener,
    const content::mojom::CreateNewWindowParams& params,
    bool is_new_browsing_instance,
    bool has_user_gesture,
    base::OnceCallback<void(content::WebContents*)>* prepare_created_contents);
```

Use a null default, declare in `ac_content_hooks.h`, register in `ac_seams.mm`, and carry the Chromium changes in `engine/patches/series` using existing content-hook conventions. Call immediately after the active-file-chooser rejection, before source SiteInstance/storage namespace work, prerender selection, or contents creation. RFH has already performed sandbox/activity/CanCreateWindow popup checks, consumed activation, and applied COOP. Do not synthesize a gesture or bypass those checks.

Eligible accepted non-form HTTP(S) new-window requests include `_blank` and `window.open`, with or without an opener. Exclude form/body, PiP, private, and non-HTTP paths. The full `CreateNewWindowParams` already provides form/body, opener suppression, referrer, download policy, target, disposition, and native initiation information.

The return is a one-shot consumed-operation callback, not a boolean. Empty means continue native creation, optionally with the same-engine preparation callback. Nonempty means consume the cross-engine open and requires an empty preparation callback. The handler only matches and captures value/refcounted native metadata plus frozen destination and weak ownership synchronously. It must not post work, begin profile loading, create a window, or mutate the source before returning. Never retain borrowed params, a raw opener, a source storage namespace, or Mojo endpoints.

Keep geometry/fullscreen security work inside `WebContentsImpl`, where `AdjustWindowRect` is accessible. Capture weak source/opener and the opener document token before calling the hook. For a nonempty consumed callback, copy the original WindowFeatures and all conditions needed after event dispatch. If the original path would reach `ShowCreatedWindow` (`!is_new_browsing_instance`), call `AdjustWindowRect` and `ForSecurityDropFullscreen(display_id)` before invoking the callback. Nullopt cancels the operation. After these calls, revalidate weak source/opener, active/live opener, unchanged document token, and source delegate before any member access or destination execution. A matched operation canceled here must not resume stock creation.

Move-run the consumed callback with adjusted features and the returned fullscreen guard, then return null without further member access. RFH's existing weak-owner check handles destruction; otherwise it returns `kIgnore`. Only now does the callback post the owned destination operation. Carry WindowFeatures through `NavigateParams.window_features`/the existing popup-feature handoff. Move the guard into the pending operation when destination profile/window readiness is asynchronous, and release it immediately after native creation or cancellation, not after JavaScript adoption. It holds Chromium's temporary fullscreen-entry blockers across that wait. The original noopener/new-browsing-instance path does not reach `ShowCreatedWindow`; give it unchanged features and an empty guard, retaining its existing security behavior rather than imposing a new fullscreen policy.

For a matched same-engine sidebar/Little action, return an empty consumed callback and supply the one-shot preparation callback. Keep native creation/opener mechanics intact, as G28 requires. `WebContentsImpl` runs preparation after creating/selecting contents but before `WebContentsCreated`, `AddNewContents`, or navigation loading. It seeds the exact sidebar/action/original disposition; the delegate uses this frozen decision to select the appropriate compatible host and offer the tab. It does not match again. The normal `ShowCreatedWindow` security gate remains in that stock flow. Early failure destroys the local callback. No match or no placement change leaves the stock path untouched.

Do not use `IsWebContentsCreationOverridden`/`CreateCustomWebContents`: their inputs omit important metadata and their return bypasses default ownership/loading machinery. Do not rely on `AddNewContents` alone: source context is already chosen, prerendered contents may already exist, and opener-preserving `ResumeLoadingCreatedWebContents` runs before that callback. The pre-creation seam avoids a source-context ghost tab and asynchronous cleanup after a wrong-profile request.

### Placement, adoption, cancellation, and focus

Extend destination `WindowHost::PendingOpen` with the exact sidebar ID, action, original disposition, and weak real source. Use the target host's scoped pending operation. Native `Navigate` starts loading before tab-strip insertion, so attaching identity only in `OnTabStripModelChanged` is too late.

During synchronous target contents creation, expose that exact scoped seed to existing `ACContentBrowserClient::GetWebContentsViewDelegate(contents)`. It runs during `WebContentsImpl::Init`, after primary frame-tree initialization and before view/load creation. Copy the seed into simple WebContents user data for the matching target context/primary contents, consuming it once. Do not construct wrappers or call partially initialized contents. `TabBridge::GetOrCreate` later consumes the seed to establish durable sidebar identity and placement. This is pre-load identity, not a navigation bypass or URL lookup.

Use existing offered-tab/adoption ownership and carry the native decision in `announceOpenedTab`/`OpenWindowRequest`. Emit the decided URL/action/sidebar immediately; do not wait for the current about:blank URL to change. `openFromPage` handles resolved placement before its current/small/split/window branches; it must not replace a decided destination with `from.profileId` or an engine-based guess. JavaScript adopts the contents; it does not issue a second load. The current hardcoded `userGesture: true` and `postBody: false` are not eligibility facts.

Preserve background intent in `PendingOpen`, seed, and event even if `Navigate` normalizes its own disposition. Use `kNoAction` and no foreground focus/sidebar switch for a background result. Selecting a first tab inside an inactive native Browser is not permission to activate its UI window. Foreground actions use the existing activation path once after the destination exists. Preserve original popup disposition and adjusted bounds through the existing `TabBridge` popup-feature handoff; only the underlying staging navigation/insertion may coerce that disposition to a normal tab.

Reuse `WithProfile` and existing loading waiters. A pending operation owns copied metadata and weak source/host references until creation. Capture the original host and source sidebar when accepting the operation, before fullscreen event callbacks or profile loading; moving the same live contents to another host or sidebar invalidates that ownership. Revalidate that the destination sidebar still exists and maps to the captured engine, the profile has not been deleted/released, and the original source owner/command is still live and unchanged. Settings edits do not rematch an accepted operation. A source Stop must explicitly cancel the pending open because the intercepted source has no NavigationHandle: add cancellation in native `stop`, `close`/`closeNow`, owner destruction, and source-document replacement. Use existing navigation notifications to invalidate the owning source operation; do not treat the intentional interception as failure or invent a routing-loop protocol. Independent routed opens from the same unchanged source remain independent; a later routed click must not cancel an earlier accepted background open.

Completion/cancellation releases the operation exactly once. After native Browser/offered-tab ownership takes over, later source close must not kill the independent destination tab. Use existing offer expiration/discard when adoption fails. A deleted destination or failed profile load must not silently retry under another engine.

Make adoption of an already-started routed request mandatory. Carry a bounded `requiresAdoption` field alongside its existing token through the placement event/store/view, independent of whether the token is still present in the native offer map. In `ArdiaCoreWebView.ensureTab`, a missing, expired, closed, dismissed, or incompatible required token terminates that view/tab through existing close/failure events and disposes any unclaimed contents. It must not fall through to `WithProfile`/`openTab(url)`, as the current implementation does after `takeOffered` returns nil or `canTake` rejects. Apply this to offered routed contents and started `link:` preloads. An unstarted external input has no required-adoption marker and legitimately uses normal destination creation. This marker governs contents ownership, not rule evaluation or navigation-loop suppression.

Apply creation and ownership properties atomically at the existing Expo props-completion boundary. Expo iterates its property dictionary without a guaranteed order, and the current `setAdoptId` can synchronously create or adopt contents on an already-mounted view. Stage only URL, engine/sidebar identity, adoption token/requirement, transfer key, and creation-kind fields in an explicit-nil-aware delta; mark the native ownership batch pending before any of them changes. While pending, creation and direct window-move adoption must wait. Commit every relevant batch before `CefWebView.propsDidUpdate`'s first-mount-only guard, assign fields without eager setters, then resume existing creation/adoption once. An identity change invalidates an existing profile-loading completion using `_createGeneration`; an attached tab's sidebar update changes identity without reloading. Do not replay consumed tokens on unrelated visual-property updates. Keep `requiresAdoption` durable after consuming the token, validate an adopted tab's seeded destination before attach, and retain the started status of expired preloads rather than treating them as new inputs. No Expo-core patch, timing delay, extra handshake, or new scheduler is needed.

The guarantee concerns this routed navigation's first request; unrelated page prefetch/prerender that predates the routing action cannot be retroactively prevented.

## Source map and implementation handoff

| Area | Files and concrete work |
| --- | --- |
| Settings and deletion | [settings.ts](../apps/browser/src/store/settings.ts), [profiles.ts](../apps/browser/src/store/profiles.ts), [persist.ts](../apps/browser/src/lib/persist.ts): union, normalization, unresolved deleted targets, sidebar launch hint, remove old boolean |
| Native configuration and external inputs | [linkRoutes.ts](../apps/browser/src/lib/linkRoutes.ts), [native.ts](../apps/browser/src/lib/native.ts), [Little actions](../apps/browser/src/components/littleArdia/actions.ts): ordered config install, per-input results, explicit failure handling |
| Typed entry | [open.ts](../apps/browser/src/components/omnibox/open.ts), [newTabBar.ts](../apps/browser/src/components/omnibox/newTabBar.ts), [Omnibox](../apps/browser/src/components/Omnibox.tsx): resolve before source mutation |
| Placement | [openFromPage.ts](../apps/browser/src/components/layout/openFromPage.ts), [ContentCard](../apps/browser/src/components/ContentCard.tsx), [small.ts](../apps/browser/src/store/small.ts), existing native tab events: exact sidebar/action/disposition, adoption without replay |
| Settings UI | [General](../apps/browser/src/components/settings/panes/General.tsx), existing settings windows/pane registry/search/app URLs and command/menu files: Links → Air Traffic Control, New Route, condition/destination controls, remove row, default selector, Open Link Preferences |
| Public bridge | [ArdiaCore.h](../engine/ardiacore/src/ardia/core/public/ArdiaCore.h), [module.ts](../packages/ardiacore/src/module.ts), [CefModule.swift](../packages/ardiacore/ios/CefModule.swift), existing WebView event type: snapshot/resolver/placement metadata; bump both [nativeApi](../apps/browser/src/nativeApi.tsx) and [AppModule](../packages/shell/ios/AppModule.swift) |
| Early load and native ownership | [ArdiaCoreHost.mm](../packages/ardiacore/ios/ArdiaCoreHost.mm), [ArdiaCoreWebView.mm](../packages/ardiacore/ios/ArdiaCoreWebView.mm), [ArdiaCoreChromeWindow.mm](../packages/ardiacore/ios/ArdiaCoreChromeWindow.mm), [ardiacore_api.mm](../engine/ardiacore/src/ardia/core/ardiacore_api.mm): destination before load, pending ownership/Stop cleanup, adoption |
| Engine integration | [ac_browser.h](../engine/ardiacore/src/ardia/core/ac_browser.h)/[.mm](../engine/ardiacore/src/ardia/core/ac_browser.mm), [ac_main_delegate.cc](../engine/ardiacore/src/ardia/core/ac_main_delegate.cc), [ac_content_hooks.h](../engine/ardiacore/src/ardia/core/ac_content_hooks.h), [ac_seams.mm](../engine/ardiacore/src/ardia/core/ac_seams.mm), [renderer client](../engine/ardiacore/src/ardia/core/renderer/ac_content_renderer_client.cc): matcher, delegate callback, creation seed, narrow seams, redirect-throttle registration |
| Pinned Chromium patches | [series](../engine/patches/series): early renderer forwarding/form population; pre-creation callback; form/download plumbing in RFH, Navigator, public OpenURLParams, NavigateParams, and LoadURLParams conversions |

The UI uses existing settings controls and Dia-derived styling. Changes commit immediately; no Save/Apply or reorder feature is needed. General/menu controls edit the same default; explicit Little commands remain separate actions. Keep stable IDs so names/icons update live. Do not add AI features or unrelated Peek UI.

Implement settings/native contracts first, then wire the existing ingress paths and editor against those contracts. Keep native policy/ownership work under one owner; settings/TypeScript work can proceed independently after the contract is agreed. Use this checkout, no worktrees, separate derived data and scratch app data if agents build concurrently. Native lifetime/profile/focus review is required against the actual diff before claiming completion; reproduce concrete findings before fixing them.

### Pinned-source basis

These source links support the chosen mechanics; line numbers refer to Chromium 155.0.8059.84. The source was inspected read-only, without touching the Chromium build cache.

- [RenderFrameImpl early forwarding and later beforeunload](https://github.com/chromium/chromium/blob/155.0.8059.84/content/renderer/render_frame_impl.cc#L5749): early branch at 5749; warmup 5824; beforeunload 5858; OpenURL metadata 6117; CreateNewWindow metadata 7069.
- [Navigator browser-side beforeunload](https://github.com/chromium/chromium/blob/155.0.8059.84/content/browser/renderer_host/navigator.cc#L1030): stock fallback keeps confirmation; RequestOpenURL starts at 1070.
- [WebContents creation](https://github.com/chromium/chromium/blob/155.0.8059.84/content/browser/web_contents/web_contents_impl.cc#L5611): hook after chooser rejection around 5639; late opener loading before AddNewContents around 6065; Init view-delegate call around 4458.
- [RFH security and popup checks](https://github.com/chromium/chromium/blob/155.0.8059.84/content/browser/renderer_host/render_frame_host_impl.cc#L10553): validation before creation; null creation response becomes kIgnore around 10719.
- [Chrome Navigate](https://github.com/chromium/chromium/blob/155.0.8059.84/chrome/browser/ui/navigator/browser_navigator.cc#L847): cross-profile scrub at 847; load before insertion at 940/1000; background normalization at 419; source-profile precedence at 474.
- [Controller native navigation](https://github.com/chromium/chromium/blob/155.0.8059.84/content/browser/renderer_host/navigation_controller_impl.cc#L4385): request creation and Navigator dispatch, without returning through renderer BeginNavigation.
- [Blink same-document early return](https://github.com/chromium/chromium/blob/155.0.8059.84/third_party/blink/renderer/core/loader/frame_loader.cc#L791): fragment handling precedes the proposed renderer seam.

## Verification and completion

This plan does not authorize new test files or new cases in existing test files. Run existing relevant checks and use the existing harness plus temporary fixtures for the acceptance matrix. Any persistent regression test additions need the repository's separate explicit approval.

Run the relevant existing `linkRoutes`, `small`, `launchTab`, `privateSessions`, and `session` checks, plus typecheck and applicable native acceptance/activation tooling. This engine/lifetime/profile/focus change requires the repository's final full checks once after focused validation. Follow [agent-brief](agent-brief.md), [testing](testing.md), and [engine-build](engine-build.md) for commands. Use `scripts/agent/build-app --as <agent>` and incremental engine builds under the Chromium lock; never clean the build cache or run `gclient sync`.

Exercise only a hidden test instance with scratch `ARDIA_DATA_DIR` and a free high debugging port. Do not touch the owner's installed Ardia or real browser profiles. Use in-process captures if desktop capture is unavailable and state any missing visual verification. Stop owned servers and test instances afterward.

| Acceptance area | Required observation |
| --- | --- |
| Matcher/editor | First displayed match; all recorded Contains/equality comparisons; every destination choice; incomplete rows cannot match everything; edits persist and affect next request |
| Typed navigation | Cross-Space and Little preserve source/group; same-Space/no-match retain normal behavior; no stray blank source tab |
| Page navigation | Ordinary, no-gesture script location, Cmd-click, `_blank`, and window.open reproduce the matrix; GET/POST forms preserve query/body and source behavior |
| beforeunload | Unmatched/same-Space navigation keeps native confirmation/Cancel; cross-Space route does not prompt or navigate source |
| Redirects/history | Unmatched-to-matching 302 stays put; fragment-only navigation stays put; destination native load does not rematch; reload/back/forward remain native |
| Browser identity | Disposable source/destination cookies plus server logs show the routed first request only under the chosen engine; UI placement alone is insufficient |
| Same engine | Two sidebar profiles sharing browser data still get exact placement; G28 opener-present behavior uses native creation |
| Background | Cmd-click into an empty destination Browser still does not activate its Space/window; test original disposition independently of Chrome's normalized value |
| Little and explicit actions | Rule opens separate Little with source identity; external default is independent of unmatched page navigation; explicit open/promotion preserves live contents/history and named destination |
| Startup and batches | Match before preload; unloaded engine waits safely; early decision survives hydration; repeated/mixed inputs retain occurrence/token alignment; every action is honored |
| Ownership/failure | Source Stop/close/replacement, destination deletion/share remapping, failed profile load, dismissed early Little, and expired/incompatible required adoption leave no orphan, duplicate, uncertain-profile request, or late activation |
| Native restrictions | Forms, downloads, popup checks, source fullscreen/display handling (including source destruction during callbacks), initiator validation, referrer isolation, private contexts, internal/custom schemes, and script-URL admission retain native handling |
| User-visible settings | Links pane/search/command works; no independent contradictory default toggle; route deletion and default fallback match the recorded specification |

Record source URL/history, source/destination tab counts, exact sidebar/window, focus, and request logs. Update [the parity checklist](dia-feature-parity.md) only to the delivered/verified scope. Passing builds and model review do not establish runtime profile isolation or exhaustive Arc parity.

## Review record

### Source implementation handoff, 2026-10-23

Implementation and independent source review were completed before the initial build handoff. Review findings were reproduced and corrected with the implementation owner. No release, installed-app launch, real-profile access, or new test cases were performed during that handoff.

The working tree contains the settings/editor/commands, direct settings cutover, ordered native snapshot, typed/external routing, native matcher and pending operations, both Chromium seams, form/download metadata propagation, exact sidebar placement, atomic Expo ownership properties, required adoption, and bounded preload-to-view handoff. Native API versions are both 13. The patch files are `chromium-open-url-form-download.patch`, `chromium-renderer-navigation-forwarding.patch`, and `chromium-new-window-routing-hook.patch`, registered immediately after `chromium-initial-document-access.patch`. The engine build guide documents them; the parity checklist now records the bounded local verification below.

Checks passed: workspace typecheck (8/8 tasks, including demo icon coverage); browser tests (465/465, no skips); core tests (65), sync JavaScript tests (31), sync Swift tests (66), import Swift tests (32), existing ArdiaCore C++ tests, migration E2E, and Raycast tests (1). Swift frontend parsing of the modified Expo and shell modules passed; parsing is not native typechecking. Existing test assertions/stubs were adapted to the replaced API, and two obsolete routedLinks cases were removed. Each new Chromium patch independently passed apply, apply-check, and reverse-check on pristine pinned files after the existing initial-document patch; reversing the whole sequence restored every touched source byte. `git diff --check` passed.

Source review corrected async source-owner and destination-mapping races, rule whitespace, resolution-error fallback, popup disposition/features, stable form-submission metadata, pre-load sidebar identity, and required adoption for offered/preloaded/transferred contents. The final preload review also corrected a helper namespace mismatch and a nil-collection expiry guard that could otherwise close a tab after handoff. The reviewer reported no other blocker within those inspected paths. Saved Tamsui discussions were checked and contained no comments; that does not establish human acceptance.

At the source handoff, no Chromium checkout, Pods, or framework was available locally, so compilation and runtime checks were pending. The subsequent Zeno bootstrap and local validation below supersede that limitation. The cross-engine new-window handoff preserves the available origin/frame/process metadata but cannot obtain `initiator_navigation_state` through the inspected public RFH API; successful compilation and measured popup behavior do not establish every initiator/security variant. Expired unadopted requests intentionally fail closed instead of replaying their URL.

Earlier design review was followed by live beforeunload/form/script measurements and pinned-source research. Those findings replaced the initial-navigation throttle proposal and hyperlink-only assumptions with early renderer forwarding. The later Google correction adds only a redirect-stage throttle for explicitly tagged candidates; it does not restore the discarded generic replay or loop machinery, multiple-condition speculation, or fixed-Space-only rule model.

Final native source review established the two seams, minimal form/download plumbing, same-engine creation callback, target-host pre-load identity seed, original background intent, and pending-operation cancellation. Its second pass found two concrete omissions, independently reproduced in the source and incorporated above: the consumed opener-window path must preserve the later fullscreen/display security gate, and required adoption must fail closed instead of issuing another request after token expiry or incompatibility.

PAL thinkdeep was rerun twice against the revised design using the same prescribed model, including an inline current document and pinned-source corrections. It supported the single matcher and reinforced adoption failure handling. Its suggestions for a renderer rule snapshot, forcing `is_renderer_initiated = false`, late source-context recreation, parsing every rule as a GURL, and routing POST bodies were rejected: they conflict with inspected control flow, the arbitrary-substring editor, or observed form behavior. Model endorsement is not source or runtime evidence. The native reviewer re-read the two corrected sections and reported no remaining blocker in that scope. The final live comparisons settle the deleted-target policy without another native mechanism. The later build and runtime record covers the implemented paths; explicitly unmeasured Arc variants remain limits on parity claims.


### Compiled build and runtime validation, 2026-10-23

Zeno built the pinned engine with the complete ungoogled overlay and Ardia patch series: `series.py check` passed 44 steps/219 paths, all 41 selected ATC/patched compilation targets passed, and the full `chrome_framework` build completed in 76 minutes with no failed actions. Compilation identified and corrected two additional `RequestOpenURL` callers, the current incognito-process accessor/dependency, and the referrer conversion include. Those four source fixes were reviewed and synchronized into this checkout. The framework transfer verified all 270 file hashes and five symlinks; its main binary SHA-256 is `b7cc36d5816864da3a057bb9a641376d7ba528ed5c7a3519ac880cee72176458`.

Both native pod typechecks passed. `scripts/agent/build-app --as atc-zeno`, using `AdHoc.xcconfig` and the transferred framework, built [the local Debug app](../apps/browser/build-atc-zeno/Build/Products/Debug/Ardia.app) in 33 seconds. The [build log](../apps/browser/build-atc-zeno/build-app.log) reports success and 231 warnings, none attributed to changed ATC lines. Embedded framework UUID `4C4C4455-5555-3144-A17E-1549B528BCE0` matches the transferred artifact; staging re-signs it ad hoc, so the embedded binary hash differs. The app is a development build and uses Metro; it is not a packaged release. Preserve Zeno's checkout and output cache for incremental work.

Runtime checks used only hidden instances of that exact app, isolated scratch data, a neutral HTTP fixture, and two independent cookie stores plus a third sidebar sharing the first store. CDP input and the existing dev harness drove real page requests; fixture logs establish cookie identity independently of sidebar placement. Settings editing was exercised through the native UI and captured in process. No owner-installed app or real browser profile was used.

| Area | Observed result |
| --- | --- |
| Matching and settings | Contains checks across URL components, case folding, first displayed match, and the recorded equality discriminants passed. Add/edit/delete controls worked; a blank row did not match; edits took effect and survived cold restart. Orphan rules fell through, including a fixed default and recent fallback. |
| Ordinary and typed navigation | Ordinary links and the actual Cmd-L submission path created the resolved destination while preserving source URL/history. Same-profile navigation retained the original tab. A pinned matching source also remained intact while its destination opened. |
| Request identity and opener | Cross-engine first requests carried only the destination fixture cookie and had no DOM opener. Shared-engine cross-sidebar `rel=opener` retained the opener and shared cookie while using the exact destination sidebar. |
| Navigation semantics | Matching GET and POST forms stayed in the source with query/body intact, including a GET form that removed its submitter. Fragment-only navigation and a matching final URL reached through an unmatched 302 stayed in the source. A download-attribute link stayed on the native download path with the source cookie. |
| beforeunload and scripts | Matching cross-profile navigation left the armed source untouched without a prompt. The unmatched control prompted, and Cancel preserved it. An automatic script navigation without page activation routed correctly. |
| Placement and privacy | Cmd-click retained source selection; Little routes used source identity, including preserved background intent. A routed popup retained its 500×400 viewport. Private navigation remained in its isolated context. |
| Cold startup | A mixed launch batch honored each decision; repeated identical URLs produced separate destination tabs and requests. Preloads used the correct cookies. Holding JavaScript startup showed a native routed destination created before hydration, then adopted once without another request. |
| Required adoption and lifetime | Missing and expired required offer tokens closed without issuing a URL request. A held preload destination that exceeded its lease was discarded and never replayed after hydration. Closing a source after successful handoff left the independent destination alive. |

The existing native acceptance run passed 33 of 35 checks, including navigation/history, popup handling, downloads, private isolation, cross-window moves, Little Ardia, relaunch, quit cancellation, and JavaScript reload. Both failures were reproduced and explained without source changes: `page-background` compared sRGB constants against display-profile-converted screenshot pixels; `page-events` expected an old security event after private-window focus churn had evicted it from the 80-event debug buffer. The same binary passes both checks in a fresh run with `--force-color-profile=srgb`: 4/4 including boot and their `open-url` dependency. The original 33/35 result remains part of the record; this is not a claim that the unchanged combined suite passes in every order. No pre-ATC framework was available for a baseline comparison, and no persistent tests were added or changed during this runtime pass.

Evidence is retained locally under the gitignored `output/atc-validation-2026-10-23` directory: `evidence.jsonl` contains labeled state/URL/history readbacks, `requests.jsonl` contains neutral fixture requests and cookies, `links-settings.png` and `links-edited.png` show the editor, and `native-regression`/`native-controlled` contain the existing-suite results. `manifest.json` records copied artifact hashes. This directory is intentionally gitignored.

Remaining limits: forced profile-load failure, Stop/close/document replacement during the profile wait, destination deletion or engine remapping during an accepted pending operation, incompatible real adoption tokens, and source destruction during the fullscreen gate were reviewed in source but not deterministically induced in this run. Existing fullscreen acceptance passed, but actual macOS Space animation and physical modifier-key input were not established by hidden automation. The wider Arc-reference gaps listed above remain. No runtime product failure was found in the exercised ATC paths; these limits prevent claiming the entire acceptance matrix or exhaustive Arc parity is complete. At that checkpoint, changes were uncommitted and unreleased.

Cleanup: all parent-owned hidden instances, fixture servers, the delayed-start proxy, and Metro were stopped after validation; their listening ports were verified closed. The implementation owner also confirmed no remaining instances or monitoring jobs. Build artifacts, evidence, and Zeno's Chromium cache are retained. CocoaPods' path-dependent `Podfile.lock` checksum and Xcode project quoting remain local integration artifacts; they must be excluded from a future source commit.

### Historical Google follow-up: replacement navigation and initial redirect policy, 2026-10-23

The owner reported that clicking the Rythm result from Google in Personal opens Rythm in Arc, but remains in Personal in Ardia. A separate hidden instance reproduced the Ardia failure with the original four rules installed before the click: the actual result anchor points to an opaque `https://www.google.com/goto?url=CAES…` URL, followed by HTTP 302 responses to `https://www.rythm.fm/` and then `https://rythm.fm/`. The initial URL contains no matching rule text. All three document requests remain in the Personal contents because the current router only evaluates the initial navigation. Evidence is in `/var/folders/r4/414ppl6x67ld_dqv3w2lb5lw0000gn/T/ardia-atc-google-soB2zd/trace.jsonl`, especially `personal-click-ready`, `click-document-request`, and `personal-click-after`.

The same hidden instance exposed a second issue: a Google GET search form stays in Personal, but Google's intermediate page then calls `location.replace` with the search URL plus a `sei` parameter. That script navigation matches the query text and opens the results in Rythm. The original G9/G11 fixture code confirms both successful Arc script-routing cases used same-origin `location.href` assignment, so those observations do not establish replacement-navigation behavior or justify excluding all same-origin script navigation.

The follow-up Arc UI showed its Google search results staying in Personal and its Rythm result exposing a direct `rythm.fm` URL. Therefore the owner's Google comparison alone does not establish Arc's cross-site HTTP redirect policy. The subsequent H comparisons below establish the tested redirect and replacement cases; they do not justify adding general redirect-stage routing. The owner subsequently chose to keep Arc’s measured behavior rather than route matching cross-site redirects. Consequently the opaque Google result may remain in Personal; this is an explicit policy decision, not a claim that the two browsers receive identical Google links. The replacement-navigation discrepancy is corrected separately.

After the owner left Arc idle, the main agent ran H comparisons with the existing `rythm` Contains rule and an unpinned Personal source at `http://127.0.0.1:51953/source`. No settings changed. H labels identify native Arc accessibility readbacks in this conversation, with fixture sources and request logs under `/tmp/ardia-atc-google-boundary-root`.

| Case | Input | Arc result |
| --- | --- | --- |
| H2 | Ordinary `/r2` link, 302 to `http://127.0.0.1:51955/landing?rythm-h2` | Same Personal tab; a port change did not trigger routing. |
| H3 | Ordinary `/r3` link, 302 to `http://localhost:51953/landing?rythm-h3` | Same Personal tab; a host change did not trigger routing. |
| H5 | Button calls `location.replace('/landing?rythm-h5')` | Same Personal tab. |
| H6 | Button calls `location.replace('http://localhost:51953/landing?rythm-h6')` | Same Personal tab. |
| H7 | Direct anchor to `http://localhost:51953/landing?rythm-h7` | New foreground Rythm tab; Personal source retained. This confirms the rule was active during the comparisons. |
| H9 | Fresh `http://127.0.0.1:62523/early` document immediately executes inline `location.href='/landing?rythm-h9'`, before load completes | Same Personal tab at the destination. |

H5/H6/H9 support excluding CURRENT_TAB requests whose native `should_replace_current_entry` flag is set, while retaining the post-load assignment behavior measured by G9/G11. H2/H3 support keeping the current HTTP redirect behavior for these tested changes of origin and host. The Google opaque-link disparity remains distinct from replacement navigation; the owner explicitly chose to retain the measured Arc policy and not add redirect routing. The two tabs created for the H comparisons were closed, and the previously selected Rythm tab was restored; Arc was released back to the owner.


The owner selected “Keep Arc’s exact behavior” after the H comparisons. The implementation adds only the CURRENT_TAB replacement guard to `RouteOpenURL`; it introduces no redirect throttle, URL rewriting, origin suppression, or browser privacy preference change. An independent source review found no blocker. Zeno’s incremental engine build and real-tree patch checks passed, and the separate local app at `apps/browser/build-atc-google/Build/Products/Debug/Ardia.app` built successfully in 2m06s. Its embedded framework UUID is `4C4C4432-5555-3144-A162-C351FB807DBF`. The earlier framework, build, and owner’s running test instance were preserved.

A hidden instance of the new app passed all seven manual fixture comparisons: H5/H6 replacement and H9 immediate pre-load assignment stayed in the original Personal tab; H2/H3 redirects stayed in Personal; H4 post-load assignment and H7 direct matching link created Rythm tabs while retaining their Personal source. H5/H6 replaced the history entry rather than appending one. With beforeunload armed, H5 prompted and Cancel preserved the source without opening a destination; H4 routed without a prompt and preserved the armed source. A real Google homepage search for `rythm`, including the intermediate `sei` replacement, now remained in one Personal tab. Clicking the actual opaque `/goto` result followed both 302s in that tab, consistent with the retained policy. This does not claim that the opaque Google variant now opens in Rythm.

The bundled uBlock Origin privacy script attempts to rewrite Google’s `/goto` links to direct destinations. A separate disposable-profile probe confirmed the script ran, but the Google response’s lookup data also contained the opaque URL, so it could not recover a direct Rythm URL. The raw Google response already contained the opaque href, and a Chrome-version user-agent comparison did not change it. Why the owner’s Arc receives or exposes a direct link remains unproven; no real browser profile files, Arc extension configuration, or global auditing/privacy settings were changed.

Final verification: all 465 existing browser tests passed. Existing native acceptance passed 34/34 with an explicit sRGB profile; `page-events` passed separately in a fresh 3/3 run including its boot/open-url dependencies, avoiding the already documented debug-buffer ordering assumption. These runs cover 35 distinct existing checks. No persistent tests were added. Evidence and hashes are retained under the gitignored `output/atc-google-validation-2026-10-23` directory, including old/new traces, neutral fixture requests, both native results, and the browser-suite log. All parent-owned follow-up instances, their Metro proxies, and both boundary fixture servers were stopped. The owner’s original test app and its Metro server remain running. At that checkpoint, changes were uncommitted and unreleased; the earlier unexercised parity and failure-injection limits still apply.


### Final Google correction: actual result click

The owner rejected the earlier conclusion because the requested real Google flow still failed. The main agent repeated the exact homepage → search `rythm` → normal mouse click on the first Rythm result in both live browsers. Arc opened a selected Rythm destination and retained the Personal search. The latest `build-atc-google` instead followed Google’s opaque `/goto` URL and both HTTP redirects to `rythm.fm` within Personal. The four rules were unchanged. The two Arc comparison tabs and the one duplicate Ardia comparison tab were closed, and original selections were restored. The earlier choice to keep Arc behavior does not constitute acceptance of this broken real-site flow.

The implemented correction tags only eligible user-activated CURRENT_TAB navigations that continue through the stock delegate. A redirect-stage throttle reads the exact native request metadata and captured source ownership, matches an outgoing cross-site destination before its request begins, and hands it to the existing native destination-open path while canceling the source navigation. It excludes replacement navigation, forms/POST, reload/history, private contexts and subframes. It does not rewrite Google DOM, scrape visible result labels, or reroute all committed pages. This is an explicit expansion beyond the earlier initial-navigation-only policy; actual Google outcome parity is the acceptance criterion. New-tab redirect handling remains outside this bounded fix. The existing H observations remain historical evidence, not a substitute for the requested Google check.


The corrected framework and app built successfully on 2026-10-24. The framework UUID is `4C4C44CE-5555-3144-A1B5-D8F06500EA93`, and the app is the separate `build-atc-google-redirect` Debug build. Independent source review found no remaining actionable findings in the redirect handoff after source-owner/document cancellation and private/empty-sidebar admission were corrected. The owner tested the new app and reported it looking good. A read-only follow-up confirmed the Google search retained in Personal and new `https://rythm.fm/` tabs in Rythm, with Rythm selected. This last validation is owner-driven testing plus state readback, not a claim that the main agent independently repeated the post-fix click or measured destination cookies for that real website. The previous failing flow was independently reproduced in both browsers.

Final checks on the corrected build passed: 465/465 browser tests; 34/34 existing native checks with sRGB screenshots; and a separate fresh 3/3 `page-events` run including boot/open-url dependencies, covering 35 distinct native checks. The last separation avoids the documented debug-event-buffer ordering assumption. No new persistent tests were added. Logs, source hashes, result JSON, and local instance metadata are retained in the gitignored `output/atc-google-redirect-validation-2026-10-24` directory. Hidden regression instances and their servers are stopped; the owner’s visible test instance remains available.

Draft integration limit: validation used base `fce1abe1` plus this feature. Upstream advanced to `38befbb9`, including its migration to Helium 0.19.4 on the same Chromium version. A read-only three-way comparison found the feature overlaps additive after excluding machine-specific CocoaPods/Xcode artifacts, but the underlying Helium patch stack has not been applied or compiled with these ATC patches. The draft therefore requires Helium integration verification before it is ready to merge; the existing upstream prebuilt framework does not contain this feature. The broader Arc-reference and forced-failure limits above also remain.
