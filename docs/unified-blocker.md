# Unified blocker development

This draft supersedes the two-extension implementation in PR #124, which was
closed on October 24, 2026. It proposes one Ardia Blocker component, with source
at https://github.com/alexmodrono/ardia-blocker. The architecture and maintenance
plan remain subject to maintainer review.

The build fetches the exact source commit in `packages/ardiacore/blocker-source.json`
into the ignored vendor cache, verifies its clean checkout, builds it and stages
only that extension. No sibling checkout is needed. For local development, set
`ARDIA_BLOCKER_SOURCE=/absolute/path/to/ardia-blocker`; `ARDIA_BLOCKER_DEV=1`
explicitly permits uncommitted source. The bundled `ardia-source.json` records
source provenance. The source repository retains both upstream histories and licenses.

## Updating uBlock Origin

In the source fork, run `python3 ardia/tools/update.py <stable-tag>`. It verifies
the tag ancestry and release checksum, prepares an uncommitted merge, and builds
and tests the result. If upstream overlaps AdNauseam changes, resolve and stage
the conflicts, then run the same command with `--continue`. Runtime acceptance
must also pass before signing and publishing the fork commit and updating the
browser pin. The exact-match hardening patches fail if upstream code moves.
Updates are reviewable and reproducible, but not guaranteed to merge automatically.
AdNauseam updates have their own pinned release and merge instructions in the fork.

The native bridge retains the wire values `ublock` (Standard) and `adnauseam`
(Active obfuscation) to reuse its existing transactional consent and profile
handling. Both values resolve to the same component ID and bundle. Switching
revokes consent, holds navigation while the component reloads, reapplies shared
settings and grants consent only after success. Failure attempts to restore
Standard and reports any restoration failure. Existing pages should be refreshed.

Onboarding defaults to Standard and confirms active obfuscation before advancing.
Settings has the same choices, protection pause, Ad Vault and AdNauseam preferences.
The vault stores ads locally, survives mode changes and offers deletion/export.
AdNauseam preferences can narrow visits further, including click probability,
DNT handling and site exclusions. They cannot grant Ardia's consent.

Standard enforces ordinary blocking without collection or visits. Active mode
uses AdNauseam's full parsers, collection exceptions, malware rules and visiting
queue. It contacts advertising services and uses extra data; obfuscation's privacy
benefit is not guaranteed. Private tabs are excluded using browser-owned metadata.

The fork also adds native Global Privacy Control, CNAME uncloaking, conservative
navigation cleaning, opt-in site-data deletion, and per-site controls. See
[privacy protections](privacy-protections.md) for scope and compatibility details.
These require the additional engine patch and a matching local framework.

## Checks

```sh
bash packages/ardiacore/scripts/unified-blocker.sh
blocker_commit=$(python3 -c 'import json; print(json.load(open("packages/ardiacore/blocker-source.json"))["commit"])')
blocker_source="${ARDIA_BLOCKER_SOURCE:-packages/ardiacore/vendor/unified-blocker/source/$blocker_commit}"
npm --prefix "$blocker_source/ardia" run check
pnpm --filter @ardia/browser typecheck
pnpm --filter @ardia/browser test
pnpm --filter @ardia/ardiacore test
scripts/agent/build-app --as unified --config Release --force
node packages/ardiacore/scripts/unified-blocker-test.mjs \
  apps/browser/build-unified/Build/Products/Release/Ardia.app
node packages/ardiacore/scripts/blocker-counters-test.mjs \
  apps/browser/build-unified/Build/Products/Release/Ardia.app
node packages/ardiacore/scripts/privacy-test.mjs \
  apps/browser/build-unified/Build/Products/Release/Ardia.app
```

The live test launches a hidden Release build with an isolated `/tmp` profile and
performance probe (for its test harness). It exercises real network blocking,
image collection, intercepted scheduled visits, private browsing, pause/resume,
background restart, Standard revocation, and the actual React onboarding/Settings
components. Test ad visits are intercepted locally; none reach an advertising
service. The fixture provides a DNS answer only for its synthetic ad hostname,
which otherwise has no public DNS record; production target validation stays intact.
Results go to `apps/browser/build-unified/acceptance/results.json`.

The test build uses the original Chromium helper identifiers, so launch it by its
explicit bundle path with a fresh `ARDIA_DATA_DIR`. Never copy it over the installed
browser or use a personal browser profile. The interactive demo uses embedded
Release JavaScript, so Metro and its Refreshing banner are not involved.

## Validation on the current upstream base

Validated on October 25, 2026, against browser base
`53ef1bc9c6290f601e9330e60f4def3813d0bfda` and source fork
`e378fb9143ea905d84e26ada37a48665687c7335`. Native API 19 adds the per-tab blocker statistics bridge to this
combination of upstream engine selection and unified privacy controls.

- Root `pnpm typecheck` and `pnpm test` pass; the browser suite has one existing skip.
- The web demo builds; all 278 app symbols have artwork. Rendered onboarding checks
  cover search → protection → pins, cancelled and accepted consent, Back, Standard
  revocation, and recap updates. That web test uses a stubbed native bridge.
- The engine series applies in 63 steps and reproduces all 278 touched paths of
  the local Chromium tree. The incremental rebuild compiles 69 translation units
  from the generated Ninja commands, regenerates extension permissions, and links
  the framework. Existing Chromium objects are reused. No build-cache cleanup or
  source sync is performed. The ordinary build driver requested a broad rebuild
  because earlier generated dependencies were newer than cached objects; this
  local validation uses the explicit incremental build instead.
- Release and Debug apps build with that refreshed framework.
- Unified native runtime: 18 checks pass, including current onboarding and actual
  Chromium → WebKit → Chromium switching. WebKit shows no Chromium protection
  panel; switching back restores it.
- Additional privacy: 13 checks pass. Site pause/resume: 4 checks pass, including
  cancellation of an intercepted visit and restored hiding, collection and visits.
- Two-profile switching and injected failure recovery: 3 checks pass.
- The interactive recording page passes real collection and intercepted visits,
  live Standard revocation, site pause/resume, measured GPC/tracker probes, tagged
  navigation, and display reset without deleting the vault.
- Broad Debug acceptance initially passed 141/145 checks. All four failures pass
  in focused reruns after fixing duplicate engine events and two test timing issues: an
  uncached remote filter-list toggle and a click before the PiP popover settled.
  The affected permission/download rerun passes 9 checks; the final settings/PiP
  rerun passes all 5, including native PiP window controls.
- The pinned public fork builds and its 26 checks pass.
- Engine permission and download events are routed by their existing IDs so the
  shared macOS event bus delivers each event once, including when both engine
  modules are present. Six regression cases cover shared and separate buses.

The performance ceilings are **not green**. The Node operation-count check is
15 operations over its existing `groupLabel.500.afterMemberTitle` ceiling
(14,903 versus 14,888); all 17 counts exactly match unchanged `main`.
The JavaScript ratchet repeats both large and small sessions and reports 44
counts over their stored ceilings. The same 44 exceed their ceilings with the
upstream UI from `53ef1bc9`, on the same native app/framework (only its native-API
guard is adapted from 16 to 18). No new ceiling category fails in this PR, but
its added UI has measurable cost: one extra launch mount, 13 extra mounts across
13 tab switches, 102 extra selector calls and 50 extra subscriber notifications
in that switching scenario. Typing and hover render counts match the control.
These count comparisons do not establish native timing parity or the cost of
Active obfuscation on real websites. Existing ceilings are unchanged.

A local native benchmark completes three launches and one full session (1, 10
and 20 tabs, two 60-second idle windows, tab switching, new tabs/windows, and
memory after closing tabs). No paint samples are excluded. Observed medians are
374 ms to a window with content, 11 ms to show a switched tab, and 83 ms to a new
tab's first paint. These are diagnostic measurements of a local Release build,
without an interleaved stable control. The idle windows record 52 seconds of
user input elsewhere on the Mac, so their CPU figures are not a quiet-machine
comparison. This does not qualify a release or establish performance parity.

Runtime checks use isolated profiles. Synthetic ad visits are intercepted locally;
none reach advertising services. The [recording page instructions](../packages/ardiacore/scripts/protection-demo/README.md)
explain how to reproduce the interactive demonstration.

This remains a draft for the maintainer's architecture and maintenance review.
An eventual release needs a matching engine prebuilt and corresponding source
archive, plus the stable release's compatibility and performance qualification.
This PR publishes neither an engine prebuilt nor a browser release.

## Earlier onboarding captures

These captures predate the current upstream onboarding refresh:

![Standard selected by default](images/unified-blocker/onboarding-standard.png)
![Active obfuscation explanation before consent](images/unified-blocker/onboarding-active.png)

## Shield counter correction

The October 25 real-site investigation reproduced AS filtering requests internally
while the native failed-request counter remained zero. The shield now reads the
blocker's count by the native extension tab ID, including safe resource
replacements. It does not sum tabs by URL or estimate tracking from a site's
reputation. The isolated counter acceptance checks blocked/replaced requests,
identical URLs in separate tabs, private counters, rendered values, same-document
navigation, full navigation resets, and filter-list access in Active mode.
The rebuilt demo's AS tab reported eight filtered requests, matching its blocker
page store. Counts vary by session, consent choices, mode and page activity.
