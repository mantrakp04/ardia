# Unified fork privacy protections

This work belongs to the `unified-blocker-pr` proposal, separate from PR #124.

Global Privacy Control is enabled by default in the engine. Settings → Privacy
can change it for each profile. It uses Helium's native preference, so the HTTP
`Sec-GPC` signal and `navigator.globalPrivacyControl` agree in pages and workers.
It communicates a preference; it does not itself block tracking.

The single bundled extension uses uBlock Origin's DNS-uncloaking adapter with
Helium's proxy-aware resolver and promise-capable webRequest API. Native access
is restricted to the bundled component identity, not ordinary extensions with
the same requested permissions. It preserves filter exceptions, ignores aliases
within the same registrable domain, does not recheck main-page requests, uses a
bounded DNS cache, and allows a request to proceed if DNS resolution fails or
takes more than 1.5 seconds. The browser's proxy and Secure DNS policy remain in
charge. Settings and site controls expose a switch and per-site exceptions.

Navigation cleaning removes a small explicit set of advertising identifiers and
UTM parameters from HTTP(S) main-frame GET requests. It preserves the exact bytes
of remaining query fields. Authentication, checkout, known signature/token
parameters, credential-bearing URLs and non-GET requests are excluded. Per-site
exceptions retain links unchanged. No cleaner can recognize every custom signing
scheme, so exceptions are available and the feature can be disabled per profile.

Forget after closing is off by default. Enable it in a site's controls after
confirmation. It waits until the last normal tab for the registrable site closes,
then clears cookies for that site and storage for its observed origins (including
ports and visited subdomains). This is intentionally not a history-deletion tool.
It records only origins belonging to opted-in sites. A short delay and another
live-tab check avoid clearing data during ordinary close/reopen sequences. An
already-dispatched asynchronous browser deletion cannot be cancelled; reopening
at that instant can still require signing in again. Private tabs never trigger
deletion of normal-profile data. Pending cleanup survives an extension restart;
failures remain visible in Privacy Settings. Other profiles are unaffected.

The site panel shows the running mode, existing page-block counts, GPC state,
link-cleaning and CNAME exceptions, and the forget setting. These are per-profile
privacy settings; content-blocker mode selection retains its existing shared
behavior. Pausing content blocking also pauses CNAME rechecks and navigation
cleaning, new ad collection, and queued visits for that site. Visits in progress
are cancelled; requests already sent cannot be taken back. Re-enabling site
protection restores collection and eligible visits in Active obfuscation. Saved
vault totals remain visible while paused. GPC remains an independent preference.

The fork generates its CNAME adapter from the pinned upstream Firefox adapter at
build time. Strict anchors fail the build if upstream layout changes, preserving
the source and license while avoiding a second manually maintained copy. The
extra Chromium patch grants only the existing component ID DNS access and async
request blocking and enables GPC by default. `ac_privacy_settings` exposes only
the relevant native preference; the extension receives no general browser-pref
write API.

These extension and native preference controls apply to pages opened in Chromium.
WebKit pages use their own engine settings; the shield and Chromium privacy controls
are hidden there. Switching the page back to Chromium restores them.

## Local validation

The privacy acceptance script launches a hidden Release build with a temporary
profile. It verifies HTTP/page/worker GPC, live toggling, navigation cleaning,
signed-link and form preservation, exceptions, native DNS availability and
CNAME blocking, last-tab deletion, private-tab isolation, retention when disabled,
background restart, independent profiles, and mounted Settings/site controls.
The CNAME check supplies a controlled alias to the real asynchronous request
filter; it is not a claim to have tested every public DNS/proxy configuration.

Run `node packages/ardiacore/scripts/site-protection-test.mjs <built-app>` to
exercise the actual site toggle against an intercepted ad visit. It checks
cancellation, no new collection or visits while paused, the empty shield, and
restored hiding, collection and eligible visits after resuming.

Run `node packages/ardiacore/scripts/privacy-fixture.mjs` for the local interactive
Privacy Lab. It displays real GPC signals and provides tracking-tag links, a
mock signed checkout link, a POST form, and cookies/storage for deletion tests.
The native panel lives under site controls → Privacy protections; profile-wide
options live in Settings → Privacy.

This experimental build is not a published engine prebuilt or a release. Broader
website compatibility and release performance checks remain required before
shipping it.

## Protection popover

The shield beside the address appears while hovering the URL bar or while its
popover is open. It is empty when blocking is paused, unavailable, or disabled for
the site, and filled while protection is running. It opens a compact site panel. Its ads-and-trackers
count comes from uBlock's page store for the native extension tab ID. It includes
blocked requests and requests replaced with harmless local resources, which the
browser's failed-request events miss. It is scoped to the current page load, not
unique companies, hidden elements, or script-based filtering. Different browsers
use different counting rules; zero is not proof that nothing was hidden. The
bridge rejects stale navigation responses and reports unavailable data as a dash.
Collected ads and ads clicked are derived from this profile's saved Ad Vault
entries for the registrable site, including subdomains. Only positive successful
visit timestamps count as clicked; failures and attempts do not. Saved counts
remain when Standard stops new collection and clicks, and deleting vault entries
reduces those totals. The panel adds no independent history store.

Request counts and activity refresh every two seconds while the panel is mounted. Navigating to
another page resets its loaded state. Private tabs show blocking and protection
status without exposing normal-profile ad history or an Ad Vault shortcut. The
panel also exposes connection security, GPC, link-cleaning and CNAME exceptions,
and the opt-in forget setting. Unavailable state is shown explicitly.

Filter lists are available from Settings → Privacy → Filter lists in both modes.
Regional lists can improve coverage on local-language sites; cookie-banner and
annoyance lists remain optional to preserve compatibility.

## Recording a demonstration

The [interactive protection demo](../packages/ardiacore/scripts/protection-demo/README.md)
shows real sample-ad collection and completed, locally intercepted background visits.
It also distinguishes measured GPC and tracker results from enabled settings that
the page cannot verify. Standard continues to block ads while stopping new
collection and visits; pausing site protection also makes the samples visible.
