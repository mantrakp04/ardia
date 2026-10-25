# Building the engine from source

Ardia runs on ArdiaCore: Chrome's own framework (`//chrome:chrome_framework`) built from our Chromium tree, with our
layers linked in (`docs/ardiacore-spike.md`). The tree is **Chromium 155.0.8059.84** (`CHROMIUM_VERSION` in
`env.sh`), plus **Helium** 0.19.4 (helium-chromium) and 0.19.4.1 (helium-macos) minus a short skip list, then our
patch series. Nothing of CEF's is checked out or built. CEF left the tree
on 2026-10-09: its 117 patches to Chrome are gone, except a few kept as `chromium-cef-carryover.patch`
([below](#cefs-117-patches)), and the seams of theirs ArdiaCore used are our own hooks H1–H6
([below](#our-hooks-in-chromes-code)). The framework is still named "Chromium Framework". Crashpad stays off.

What the build adds:

- **H.264 / AAC.** Set with `proprietary_codecs=true` and `ffmpeg_branding="Chrome"`; H.264 decodes
  through VideoToolbox.
- **Chrome's release optimisations**, as Helium ships them: an official build with ThinLTO and PGO (Chromium's own
  mac-arm profile).
- **Helium** (`HELIUM_TAG` and `HELIUM_MACOS_TAG` in `env.sh`, pinned by commit in `helium-pins.ini`). It is built on
  ungoogled-chromium: its series, domain substitution and name substitution strip Google's background services and
  rename the product, and we rename it again, to Ardia. Helium's own services stay off, and the Chrome Web Store,
  extension updates and the security components still reach Google. See [Helium](#helium).
- **Our patches**, in `engine/patches/`, applied in the order `engine/patches/series` gives (see
  [The patch series](#the-patch-series)):

| Patch | What it does |
|---|---|
| `chromium-helium-branding.patch` | First in the series: Helium shows as Ardia, and its services, update feed and crash server can't be reached, for the literals in source that name substitution and `ardia_resources.txt` don't reach. `helium::ShouldAccessServices` is false whatever the prefs say, and both services origins are the unresolvable `services-disabled.qjz9zk`; the update feed and the crash upload URL are empty (no switch sets one) and the crash product is Ardia. Helium's internal-page scheme alias isn't registered, rewritten or shown (the engine shows chrome://, the app shows ardia://). Extension update pings go to no domain (they did to helium.computer). chrome://credits names Ardia and its repository and keeps Helium's GPL-3.0 entry; chrome://crashes files bugs on Ardia's tracker; the Safari import dialog loses its link to Helium's wiki; screenshots save as `ardia_screenshot*.png` and the Web Store's button says "Add to Ardia"; chrome://flags says Ardia, Helium's flag ids are `ardia-*` and the updater channel and update server flags are gone. `cr:chrome-product` is Ardia's mark, Helium's indigo palette is reverted (`helium-color-scheme`), the onboarding and uBlock paks aren't packed or registered, and `chrome/app/theme/chromium/BRANDING` is Chromium's again (Ardia builds with its own, `chromium-branding.patch`) |
| `chromium-cef-carryover.patch` | The CEF patches we keep ([CEF's 117 patches](#cefs-117-patches)): `BrowserManagerService::DeleteBrowser`'s destruction order, no `NOTREACHED` for unmapped Mac key codes, bubbles kept on screen on the Mac (`kAdjustBubbleIfOffscreen`), a window with a child-modal sheet resizable and the sheet's focus back after the resize, the ResourceBundle delegate parameter H5 passes to `LoadLocalState`, the tab strip API's colour provider without an active tab, and `browser_tests` building without background mode (for `enable_background_mode=false`) |
| `chromium-extension-window-hidden.patch` | The windows of ArdiaCore's own pages are invisible to chrome.windows/tabs (`g_ardia_hidden_from_extensions`, also read by the next patch and apply.sh's `browser_window_util` hook): not listed, not found by id (`ExtensionTabUtil::GetTabById` and `GetControllerInProfileWithId`, so tabs.get/update/remove, scripting and tabs.sendMessage on a leaked id fail as for a closed tab), no tabs events (`TabsEventRouter::ShouldTrackBrowser`) and no webNavigation events for their tabs, or for tabs they open |
| `chromium-component-extension-restricted-urls.patch` | Chrome lets every `kComponent` extension script any page (`PermissionsData::CanExecuteScriptEverywhere`), Web Store included. For the component extensions Ardia bundles (`g_ardia_restricted_component_extension`, set in every process by `ACMainDelegate`: uBlock Origin's id), `IsRestrictedUrl` makes Chrome's usual checks anyway: no scripts on the Web Store, chrome:// pages or other extensions' pages. Nothing else about `kComponent` changes |
| `chromium-helium-ublock-off.patch` | Helium's uBlock Origin component (`blockjmkbacgjkknlgpkjjiijinjdanf`) is neither built nor loaded, and isn't pinned by default: no `AddUBlock`, no `//third_party/ublock` deps, grit headers or resource entries (the branding patch drops its pak). Ardia runs its own uBO (`fajbdaomknpkicfjcpipdmcpoamdmilh`), so users keep their filters and two engines don't filter every request |
| `chromium-helium-onboarding-off.patch` | Helium's onboarding page (chrome://setup) isn't built: no WebUI target, resources, strings, chrome://chrome-urls entry or first-run opener (the branding patch drops its pak and registration), so Helium's services consent stays off. chrome://credits keeps Helium's GPL-3.0 entry with its licence text in `third_party/helium/LICENSE`, and leaves out the onboarding font |
| `chromium-helium-services-page-off.patch` | Settings has no Helium services page: no route, no view, no "set up services" button opening chrome://setup. Helium services stay off in Ardia (the branding patch, which also removes its row), so it only offered switches that do nothing |
| `chromium-helium-search-assets-off.patch` | Built-in search provider assets are on only for Chrome-branded builds again (Helium turns them on; `enable_builtin_search_provider_assets` in `chrome_build.gni` isn't a GN argument): the build doesn't fetch Helium's non-free search engine assets |
| `chromium-helium-bangs-off.patch` | Helium's `BangManager` (add-native-bangs) never fetches: `LoadBangs` answers at once with no bangs, so no loader is made and nothing is requested (it made a cache-only request to the services-disabled placeholder at every launch). Chromium's omnibox never uses bangs in Ardia; the address bar is the app's own (`packages/core`) |
| `chromium-helium-rlz-for-cdm-storage-id.patch` | `enable_rlz` can be true again (`gn_defines.sh` sets it): it reverts the `rlz/buildflags/buildflags.gni` hunk of the `disable-rlz` patch Helium applies, as our ungoogled build did. Widevine's CDM storage id (`enable_cdm_storage_id`) hashes RLZ's machine id on the Mac, so every user's storage ids and licences stay the same. RLZ itself stays inert: there's no brand code |
| `chromium-helium-ntp-third-party.patch` | chrome://newtab opens the New Tab page Ardia 0.2.39 did: chrome://new-tab-page-third-party unless Google is the default search engine. It reverts the `search.cc` hunks of Helium's `always-use-better-ntp`, which sent every engine to Chrome's WebUI NTP (it needs a BrowserView, which ArdiaCore's browsers lack), and puts back the `search.cc` part of ungoogled's `0008-restore-classic-ntp`, which Helium leaves out |
| `chromium-helium-context-menu-cast.patch` | The page's context menu keeps Cast…, as in 0.2.39: it reverts the `AppendPageItems` hunk of Helium's `degoogle-context-menu`. Cast works through `chromium-cast-dialog-hook.patch`, with mDNS on |
| `chromium-helium-devtools-inspect-shortcut.patch` | DevTools' Select an Element (`elements.toggle-element-search`) is ⇧⌘C again, as in Chrome and 0.2.39: it reverts the `elements-meta.ts` hunk of Helium's `keyboard-shortcuts`, which moved it to ⇧⌘E, so ⇧⌘C in a focused DevTools fell through to the app's Copy URL. Helium's other changes there (`IDC_COPY_OR_INSPECT_SHORTCUT`, its reserved commands and global shortcut table) don't reach ArdiaCore's windows, whose keys go through ArdiaCore's own command dispatcher and the app's menu |
| `chromium-password-bubble-hook.patch` | ArdiaCore may replace Chrome's password bubble (`g_ardia_password_bubble`) |
| `chromium-extension-install-prompt-hook.patch` | ArdiaCore may replace Chrome's extension install dialog (`g_ardia_extension_install_prompt`) |
| `chromium-branding.patch` | Ardia's bundle and team id (`branding_file_path`), for the passkey and payments keychain access groups; product names stay "Chromium" |
| `chromium-safe-storage-name.patch` | The Safe Storage key lives in its own "Ardia Safe Storage" keychain item, account "Ardia". **Load-bearing:** it's Chromium's own `os_crypt` code, so ArdiaCore uses it too, and every user's saved passwords and cookies are encrypted with that item's key. Keep it, unchanged, through every re-sync and version bump; without it Chrome reads "Chromium Safe Storage" and nothing decrypts |
| `chromium-safe-storage-no-silent-reset.patch` | Ardia never replaces its Safe Storage key. Chromium added a new key whenever the item didn't show up, and its add looked the item up again and overwrote it if it was there by then, so an item briefly invisible at login left every saved password and cookie undecryptable. Now a missing item may be created only when `g_ardia_safe_storage_key_may_be_created` says so: ArdiaCore (`ac_safe_storage.mm`) allows it when, at startup, the user data dir had no `Local State` and no entry holding `Preferences`, `Cookies`, `Network/Cookies`, `Login Data` or `Web Data` and every check answered cleanly (any error but "not found", and any link that doesn't resolve, counts as existing data), or once after the user chose to start over. The add is add-only (`KeychainV2::AddGenericPasswordIfAbsent`): an item that appeared meanwhile is read back, never overwritten. Otherwise the key provider retries 3 × 1 s and fails closed; `g_ardia_safe_storage_unreadable` then gets the error and the retry, and ArdiaCore asks: a missing item, "Ardia can't read its Safe Storage key." with Quit (the default) or Start Over with a New Key, the only choice that lets one key be made; a locked keychain or denied access, unlock it or allow Ardia in Keychain Access; a missing entitlement, reinstall Ardia from ardia.dev; an undecodable secret, "Ardia's Safe Storage key is damaged." (restore the keychain from a backup, or delete the item and try again, which then reaches the missing-item dialog); anything else, a neutral try-again. Each of those offers Quit or Try Again and creates nothing. Test instances can use a file-backed keychain (`ARDIA_TEST_KEYCHAIN=file`, `ARDIA_TEST_KEYCHAIN_HIDDEN_READS=<n>`, `ARDIA_TEST_KEYCHAIN_FAIL=decode|denied|interaction|entitlement|io`, `ARDIA_TEST_SAFE_STORAGE_ANSWER=start-over`), honoured only on the mock keychain with `--user-data-dir` resolving to `$ARDIA_DATA_DIR/Chromium` |
| `chromium-device-chooser-hook.patch` | `chrome::ShowDeviceChooserDialog` (and its extension-page variant) asks ArdiaCore (`g_ardia_device_chooser`) once Chrome's `DropFullscreenForChooserDialog` has dropped the page's full screen and revalidated the frame and active tab: ArdiaCore gets that WebContents and the full-screen blocker, which its chooser holds until it closes |
| `chromium-cast-dialog-hook.patch` | The Media Router's Cast dialog (and Presentation API requests) asks ArdiaCore first (`g_ardia_wants_cast_dialog`, `g_ardia_cast_dialog`). Both paths reach `CreateMediaRouterDialog`, which asks ArdiaCore only after Chrome's `ForSecurityDropFullscreen` has dropped the page's full screen and the window has survived the drop; ArdiaCore gets the full-screen blocker and its Cast dialog (`ac_cast_dialog.mm`) holds it until it closes, so a page can't re-enter full screen over the picker |
| `chromium-side-panel-hook.patch` | `side_panel_util` asks ArdiaCore first for an extension's side panel (`g_ardia_extension_side_panel`) |
| `chromium-ntp-promo-without-side-panel.patch` | `NewTabPageFeaturePromoHelper::MaybeTriggerAutomaticCustomizeChromePromo` returns when the tab's browser has no `SidePanelUI`, which ArdiaCore's browsers don't: Chrome's WebUI New Tab page crashed the browser (`SIGSEGV`) there on Helium |
| `chromium-initial-document-access.patch` | When another frame touches a tab's initial empty document (`RenderFrameHostImpl::DidAccessInitialMainDocument`, primary frame tree), ArdiaCore hears it (`g_ardia_initial_main_document_accessed`): the tab sends a URL and navigation-state change, as Chrome's omnibox stops showing the pending URL then. `content::ArdiaHasAccessedInitialMainDocument` answers `WebContentsImpl::HasAccessedInitialDocument`, which 155 no longer has on the public `WebContents`; `ArdiaCoreTab.initialDocumentAccessed` and `.committedInitial` (the last committed entry is the initial one) report them |
| `chromium-hidden-window-current-window.patch` | Extension pages in hidden windows (our popups and side panels) take the last active window as their current window |
| `chromium-webstore-direct.patch` | Web Store installs and extension updates go straight to Google, as before Helium. It reverts what Helium's `proxy-extension-downloads` and `spoof-extension-downloader-platform` and ungoogled's `disable-webstore-urls` do (Helium's later patches need them, so they can't be skipped): the store update URL is `clients2.google.com` again (Helium's proxy needs onboarding consent, so every install and update went to a dummy host), pending installs (sync ones included), effective update URLs, the standalone installer and `ExtensionUpdater` (the update service again, which carries the Omaha attributes) no longer swap in the proxy, requests name the real platform (`os=mac`, `prod=chromiumcrx`) instead of Windows, and `ChromeContentVerifierDelegate::IsFromStore`, the store's dedicated process and the downloader's defaults are Chromium's code again (content verification itself stays unenforced, as in unbranded Chromium before Helium). Helium's no-utm_source choice stays |
| `chromium-extension-updates.patch` | The extension update service (`ChromeUpdateClientConfig::UpdateUrl`) checks `https://clients2.google.com/service/update2/json`: Helium leaves `ConfiguratorImpl::UpdateUrl` empty, and domain substitution cut off its default host. (Its first hunk, undoing ungoogled's early `return` in `UpdateCheckerImpl::CheckForUpdates`, went: Helium's `reenable-update-checks` does the same) |
| `chromium-component-updater-security-only.patch` | The component updater fetches only the security components: CRLSet (`hfnkpimlhhgieaddgfemjhofmfblmnib`), PKI Metadata (`efniojlnjndmcbiieegkicadnoecjjef`: CT log list, Chrome Root Store, pins) and the SSL error assistant (`giekcmmlnklenlaomppkphknjmnnpneh`). `CrxUpdateService::GetCrxComponents` hands update_client no data for any other id, so scheduled and on-demand checks leave them out of the request; they stay registered, so a bundled or installed copy still loads, and a check of one ends in "Update error" without a request. `ChromeConfigurator` (the component updater's alone; the extension updater keeps its own) checks `https://update.googleapis.com/service/update2/json` with no override and no http fallback (Helium leaves `ConfiguratorImpl::UpdateUrl` empty, so nothing reads `kUpdaterJSONDefaultUrl`), sends no pings, and downloads in Chrome's network stack only (no background cache, so no NSURLSession). Its fetcher gets a destination policy (`NetworkFetcherChromiumFactory`'s `AllowedDestinationPredicate`, null for the extension updater): the update check may go only to that URL, downloads only to https `dl.google.com` or `*.gvt1.com` (any path) or `www.google.com/dl/` (port 443), checked on the first URL and on every redirect, so the server's http mirrors fail over to the https ones and a redirect elsewhere stops before it is followed; an empty request body is refused. Its requests keep only an allowlist of fields: `protocol`, `ismachine`, `dedup`, `acceptformat`, `sessionid`, `requestid` (both random per check), `@updater`, `prodversion`, `updaterversion`, `@os`, `arch`, `os`, the channels, and per component `appid`, `version` and `updatecheck`. The persisted fields Chrome uses to tie one check to the next stay out (`ping` with its `ping_freshness` UUID and day counts, `cohort*`, `installdate`, `iid`, `brand`, `cached_items`), and so do `lang`, `hw`, `dlpref`, `domainjoined` and `updaters`; the source IP address and the versions sent can still let Google correlate checks. CUP signing of the response and CRX3 publisher-proof and key-hash checks are Chrome's, unchanged. On Helium it also undoes `helium/core/component-updates.patch`: every component registers again (Helium registers only CRLSet and Widevine, so PKI Metadata never loaded), the update URL is Google's instead of `services.helium.imput.net/com` (which needs onboarding consent Ardia never asks for), and chrome://components loses Helium's "Helium services" error text; and it turns CUP back on (`ConfiguratorImpl::EnabledCupSigning`, which Helium's `reenable-update-checks` turns off; the extension update service reads it too). Since PKI Metadata replaces the compiled Chrome Root Store with any newer one, a root we distrust must also be in `kSPKIBlockList`: that list joins every CRLSet, downloaded or built in ([Blocking a compromised certificate](#blocking-a-compromised-certificate)) |
| `chromium-extension-omaha-attributes.patch` | Google's kill switch for extensions works again: the update check's `_malware`, `_policy_violation` and `_potentially_uws` answers reach `ExtensionService::PerformActionBasedOnOmahaAttributes` and its `OmahaAttributesHandler`, which blocklist (malware: unloaded, "This extension contains malware.") or greylist (disabled) the extension, as in Chrome. It restores what `fix-building-without-safebrowsing` cut with Safe Browsing: the handler in `chrome/browser/extensions/BUILD.gn` and `ExtensionService`, `ChromeExtensionSystem`'s forwarding, `UpdateService::OnCrxStateChange`'s call, and the bodies of `ExtensionRegistrar::OnBlocklistState*`/`OnGreylistState*`. Safe Browsing's own verdict handlers stay cut |
| `chromium-extension-management-policy-hook.patch` | Every profile's extension `ManagementPolicy` gets our providers (`ardia::RegisterManagementPolicyProviders`, `ac_scripts_policy.cc`) before it loads any extension: the unpacked "Ardia Scripts" extension at `<data dir>/Scripts/extension` may only hold content scripts (manifest keys, no permissions, plain script files), checked on install, reload, enable and every startup, so a manifest rewritten on disk can't side-load a privileged extension. `ac_extensions_install` of that folder refuses a symlinked folder and, while it runs, any unpacked install from another path; the policy also follows the folder's own extension id, and `ACContentBrowserClient` blocks navigation to any of its pages (`AddScriptsPagesThrottle`) |
| `chromium-extension-sync-installer-hook.patch` | Tells ArdiaCore which installs are sync installs, per installer: `ExtensionUpdater::CreateUpdateInstaller` calls `g_ardia_sync_installer_created` (profile, id, installer) for a pending install that came from sync, and `CrxInstaller::ReportSuccessFromUIThread` calls `g_ardia_crx_installing` (context, installer, extension) on the UI thread just before it hands the registrar the extension. `ac_extensions_sync.cc` keeps the sync installers until their callback runs, so an install is a sync install exactly when the installer completing it is one of them, and the user's own Web Store install of the same id is told apart from a sync install that was cancelled or is still running (extension sync, `docs/sync.md` › Extensions) |
| `chromium-unpacked-load-path-hook.patch` | Every unpacked load (install, reload, Chromium's own reloads, `--load-extension`) asks `g_ardia_unpacked_path_allowed` with the path it was given and the path it resolved to, before reading the extension; `ac_scripts_policy.cc` refuses a load that names `<data dir>/Scripts` unless it resolves to exactly the real `Scripts/extension` folder, so swapping that folder for a symlink can't load another extension under its name |
| `chromium-window-docked-devtools.patch` | `DevtoolsUIController::UpdateDevtools` tells ArdiaCore of every change to a tab's docked DevTools (`g_ardia_devtools_dock_changed`). DevTools may dock in any Browser, as in stock Chrome (CEF had turned docking off for every Browser but ArdiaCore's own) |
| `chromium-devtools-redock-display.patch` | A `RenderWidgetHostViewMac` that a `views::WebView` gives up (`SetParentUiLayer(nullptr)`) draws into its own NSView again. Chrome switched it to the Views compositor for good the first time it was attached, so DevTools docked back from their own window stayed blank in the client's view |
| `chromium-window-hosted.patch` | `BridgedContentView.ardiaEmbeddedView`: hit testing and accessibility ask the embedder's subview of a Chrome window's content view first. A Browser ArdiaCore says so of (`g_ardia_keeps_window_without_tabs`) stays open when its last tab closes, unless the window is closing |
| `chromium-devtools-window-title.patch` | DevTools' title is Dia's, "Developer Tools - <url>" (`DevToolsUIBindings` `kTitleFormat`), so Chrome's own undocked DevTools window says so too |
| `chromium-devtools-control-token.patch` | The `ardia` command's control server: a DevTools HTTP handler whose socket factory ArdiaCore claims (`g_ardia_devtools_token_factory`) runs in token mode. Every WebSocket upgrade, browser or page, needs `?token=` (`g_ardia_devtools_token_accepts`, compared in constant time; 403 otherwise) and is routed without its query; `/json*`, `/` and `/devtools/*` answer 404, and so does every other route but `GET /ardia/active?token=` (no Origin): `{"targetId": …}`, the DevTools page target of the tab the user is looking at in the last focused window, or null for New Tab and Ardia's own pages (the app reports that tab, `ac_cli_control {active}`), since an occluded window's pages all report hidden; Chrome's Host check stays and any Origin is refused, whatever `--remote-allow-origins` says; a handshake Chrome's WebSocket code would refuse (version, key) is refused before it counts. The handler reports listening, failing, going away and its connection count (`g_ardia_devtools_token_server`). The owner is `//chrome/browser/ardia` `ac_cli_control.cc` (engine call `ac_cli_control`): one server per start with a new token, published in `<user data dir>/ArdiaControl.json` (0600, written atomically, deleted on stop and at quit), never `DevToolsActivePort`. A start settles only once that file is written (a failed write stops the server and says why), and a write still queued after a stop never lands (its generation check and rename hold the lock a stop takes to revoke it). It stops when the `RemoteDebuggingAllowed` policy turns off, and stands aside when `--remote-debugging-port` runs a server. The app turns off `DevToolsAcceptDebuggingConnections` (`ArdiaCoreHost.mm`): chrome://inspect's approval mode would swap the process's one handler for its own. **A token client gets what page JS could, plus navigation, input and screenshots** (`ac_cli_token_policy.cc`, owned by `ac_cli_control.cc`; the plain `--remote-debugging-port` server is untouched): every client of a token server gets an `ArdiaDevToolsTokenClient` (`g_ardia_devtools_token_client`; a token server whose policy is missing refuses every socket). Commands, flattened child sessions included, pass an allowlist (Target discovery/attach/create/close with `flatten:true`, `Browser.getVersion`, reading DOM and Accessibility, ordinary Page/Runtime/Input calls, `Network.enable` and body reads); anything else answers `ardia: <Method> isn't allowed for the ardia command` (-32601). The allowed ones are checked further (-32000): destinations of `Page.navigate`/`Target.createTarget` are http(s), `about:blank`, `data:` or a web origin's `blob:`; execution contexts, and the context part of every object id (`<isolate>.<context>.<n>`), must be the page's main worlds, bound to the target's renderer process: learned only from `Runtime.executionContextCreated` with `isDefault`, from the `result.objectId` of a `Runtime.evaluate` without a context and the `object.objectId` of a `DOM.resolveNode` without one (both run in the default world; no other reply values are read), and from the client's own `Page.createIsolatedWorld`, whose `grantUniveralAccess` is forced off, so extensions' isolated worlds are unreachable and unannounced; no `includeCommandLineAPI`, named worlds on new documents or PDF streams. `Input.dispatchKeyEvent` takes only reviewed editing `commands` (caret moves and selection, deletes, newline and tab, select all, undo and redo; nothing that touches the clipboard, and no print) and loses `nativeVirtualKeyCode` and `isSystemKey`, so a key event carries no native event and is `skip_if_unhandled`: it reaches the renderer only, never Chrome's or the app's shortcuts and menu. Input lands only in an authorized frame: `InputHandler` checks the widget it resolved (hit testing for mouse and touch, the focused widget for keys and text) against `g_ardia_devtools_may_input` for every frame of that widget, and drops the event otherwise. A command's envelope may hold only `id`, `method`, `params` and `sessionId`, and its `sessionId` must name a session this client has attached; anything else is refused. Every command is tracked by (session, id) until its reply; a second command with the same pair is refused before dispatch, so a reply always belongs to one command (ids are read signed, and the reply's session from its trailing `sessionId`). A tracked reply that can't be parsed is dropped, and past 4096 commands outstanding on a socket (Chrome drops some without a reply, such as a navigation `Page.disable` cancels) the socket is closed with that reason rather than left wedged; a session's entries go when it detaches, crashes or its target goes away (`Target.detachedFromTarget`, `Inspector.targetCrashed`, `Inspector.detached`). With `SyntheticPointerActions` on, touch goes through Chrome's synthetic gestures, which skip the destination check, so token clients get no touch then; a drag's drop is checked against the widget it lands on too. Targets in internal Ardia windows, outside a tab strip, or not at a web URL or origin can't be attached (`g_ardia_devtools_may_attach` in `DevToolsAgentHostImpl::AttachInternal`, so workers and auto-attach too, plus the client's `MayAttachToURL`/`MayAttachToRenderFrameHost`, which detach a session whose tab navigates away, and a 403 for such a page socket), and don't appear in `Target.getTargets` or Target events. A frame counts as web only in a process with no WebUI bindings that hosts no extension (`ProcessMap`). One exception lets `waitForDebuggerOnStart` reach cross-origin iframes: auto-attach may take a child frame whose document hasn't committed yet (its target URL is still empty) when its parent is a web frame and its pending RenderFrameHost's site is http(s) or `data:` (for a main frame also an unassigned site or a `chrome-error` page); such a frame is never listed and can't be attached by id. The patch's `RenderFrameDevToolsAgentHost::ReadyToCommitNavigation` asks each session's `MayAttachToURL` about the URL about to commit, before the commit reaches the renderer, so a session is cut off at every commit, not only when a request starts (navigations without a loader, a start throttle's block, a RenderFrameHost that stays the same). `Page` navigation events that name a URL that isn't web are dropped. Local files are off (`MayReadLocalFiles`/`MayWriteLocalFiles`). Outbound, `Network.*ExtraInfo` and early-hints events are dropped and `Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization` and raw header text are stripped from the rest; only Network, Runtime, Target and Page navigation events and tracked replies are parsed, so screenshots pass untouched |
| `chromium-neterror-game.patch` | "Where's the lamb?" replaces the dino: the offline page and chrome://game (below) |
| `chromium-autofill-address-bubble-window.patch` | Chrome's offers to save or update an address (and its address sign-in promo) look the `AutofillBubbleHandler` up on the tab's Browser (`AutofillBubbleHandler::Get` on its unowned user data, as the save-card bubble already does), so they reach ArdiaCore's handler (`ACBrowserWindow::AttachBrowser` registers it): `FindBrowserWindowWithWebContents` finds BrowserViews only. It also carries CEF's `chrome_autofill_bubble_3796`: a tab with no window, or a handler that shows nothing, gets no address or card bubble instead of a crash |
| `chromium-password-generation-local.patch` | Chrome offers "Suggest strong password" without password sync (`PasswordFeatureManagerImpl::IsGenerationEnabled`); generated passwords save to the profile's local store like any other. With no account, its popup says "Passwords are saved to Password Manager on this device." instead of "…saved to Google Password Manager for ." |
| `chromium-extension-installed-bubble.patch` | Chrome's "<extension> has been added" bubble (`ShowInfoDialog`): a window without Chrome's toolbar (every client window) gets it as a bubble under the top-right corner of the window, with a close button, closing on Esc and when the window is clicked. Chrome fell back to a browser-modal sheet there, with no buttons and no way to dismiss it. The app renames "Chromium" in Chrome's strings itself (`ac_strings.cc`) |
| `chromium-tab-sharing-capturer.patch` | Each tab-sharing infobar remembers the frame whose capture it's for (`TabSharingInfoBarDelegate::capturer_id()`): a tab shows one infobar per share, and "Share this tab instead" moves only that share, never another call's |
| `chromium-desktop-capture-window-audio.patch` | A desktop getUserMedia of a window gets audio when its `DesktopMediaID` carries a `window_audio_type` (`ShouldCaptureAudio` in `desktop_capture_access_handler.cc`, which allowed audio only for screens and tabs). Only ArdiaCore's grant sets one (`ac_desktop_capture.mm`, from the share picker's audio checkbox); Chrome's own picker sets it only for getDisplayMedia, which doesn't take this path, so extensions' desktopCapture is unchanged |
| `chromium-video-super-resolution.patch` | Video upscaling on Apple silicon: a per-compositor gate (`RenderWidgetHostView::SetVideoSuperResolutionAllowed` → `BrowserCompositorMac`, kept across its compositors → `ui::Compositor` → `DisplayPrivate.SetVideoSuperResolutionAllowed` → `viz::Display`, which redraws once on a change → `gfx::FrameData`) reaches the GPU process's `ImageTransportSurfaceOverlayMac::Present`, where `CALayerTreeCoordinator::UpscaleVideo` hands the frame's video layers to ArdiaCore's upscaler (`g_ardia_create_video_upscaler`, set in the GPU process; `//ardia/core` `ac_video_upscaler.mm`). A frame whose upscale has just started holds its CA commit until the job completes (at most 0.6 of a display frame, 4–10 ms, posted, never blocking the GPU thread); a later finish replaces the committed layer's contents in a small CA commit, a redraw of the same frame takes the cached output at once, and the contents are a `CALayer`'s IOSurface or an `AVSampleBufferDisplayLayer`'s buffer alike. The browser side decides the gate (`ac_video_upscaling.mm`) |
| `chromium-begin-frame-warm-up.patch` | Opt in with `ARDIA_BEGIN_FRAME_BRIDGE=on` (`g_ardia_begin_frame_bridge`, set by `ACMainDelegate::BasicStartupComplete`, which the GPU process gets through its environment). When a tab is shown, `ExternalBeginFrameSourceMac` waits for the display link's first callback before the renderer gets a BeginFrame, so the first frame after the show can start a vsync late. With the bridge on it keeps each display's last vsync grid (timebase and interval, for 2 s) and, while it waits on the display link, sends up to 4 warm-up BeginFrames on that grid from a timer; the first real callback takes over, and a forced vsync update drops the grid. Off, the patched paths are Chrome's |
| `chromium-main-frame-throttle-after-show.patch` | With `ThrottleMainFrameTo60Hz` on (the app turns it on with `UrgentMainFrameForInput`; `ARDIA_MAIN_FRAME_THROTTLE=off` leaves both out), a renderer on a 120 Hz display sends main frames (rAF, style, layout, paint) at 60 Hz while its compositor keeps drawing at 120 Hz, and input asks for an urgent main frame. The patch keeps main frames at the full rate for the first second after a widget is created or shown (`SchedulerStateMachine::ShouldThrottleSendBeginMainFrame`), so a switched-to tab and a new page paint at 120 Hz. Its tests are in `scheduler_state_machine_unittest.cc` (`cc_unittests --gtest_filter='SchedulerStateMachineTest.*:SchedulerTest.*'`). Off, nothing changes |
| `chromium-main-frame-full-rate-on-input.patch` | Under the same throttle, main frames stay at the display rate while a threaded scroll is active (`SchedulerStateMachine::is_scrolling_`: trackpad with its momentum, wheel, keys, scrollbar) and for `ardia_full_rate_after_input` (a `ThrottleMainFrameTo60Hz` parameter, default 1 s) after it ends and after any input event the renderer's compositor sees (`NotifyInputEvent`). Without it a compositor scroll drew at 120 Hz while scroll events, rAF and everything painted from them ran at 60 Hz (keys, a mouse wheel), or at the input's own uneven cadence through urgent frames (a trackpad sending under 120 events a second), so script-moved content shook against the page. Only a page left alone (video, an idle animation) keeps the 60 Hz. `ARDIA_SCROLL_FULL_RATE=off` passes the parameter as 0 s, which is 0.2.38's behaviour. Tests next to the after-show ones |
| `chromium-thaw-live-connections.patch` | `InfiniteTabsFreezing` gets an Ardia parameter, `ardia_unconnected_unfreeze_interval` (the app passes 600 s; `ARDIA_SLOW_TAB_THAW=off` leaves it out): a frozen tab that never opened a WebSocket, WebTransport or WebRTC connection thaws on that interval instead of Chrome's minute, and a tab that did is never frozen by it (Chrome's freeze drops a WebSocket: `DisconnectWebSocketOnBFCache` acts on any freeze). The test is the frame's BFCache features, sticky ones included (`content::ArdiaFrameHasLiveConnection`, `ardia_live_connection.cc`), read when the policy decides and when its thaw timer starts. Without the parameter the policy is Chrome's |
| `chromium-temporary-tab-restore-hook.patch` | A tab ArdiaCore marks temporary (`ArdiaCoreTab.temporary`: the Peek's page, until it becomes a tab) never reaches Chrome's Recently Closed: `TabRestoreServiceHelper::PopulateTab` asks `g_ardia_live_tab_skips_restore` (ArdiaCore: the tab's `SessionID` is in `TabBridge`'s temporary set) and records no navigations for it, so the single-tab close, an extension's `tabs.remove` and a window's or group's close all leave it out, and no real entry is evicted to make room for it. A window entry renumbers the tabs it keeps and maps the selected tab into them; when the temporary tab itself was selected, its source (the hook names it) is selected instead, else the nearest kept tab, so `chrome.sessions` reports the right active tab |
| `chromium-hosted-browsers-no-session-service.patch` | Chrome's `SessionService` tracks no Browser ArdiaCore hosts (`g_ardia_omits_from_session_service`, answered by `ACBrowserWindow::IsOurs`), the ones Chrome creates and ArdiaCore adopts (`chrome.windows.create`) included, as its own already were (`omit_from_session_restore`). Ardia keeps its own session (`session.json`), so after a crash Chrome's last session brings back nothing, a Peek included, into Recently Closed |
| `chromium-battery-saver-full-rate-on-input.patch` | Chrome's Battery Saver caps every frame sink at 30 Hz (`content::StartThrottlingAllFrameSinks`), scrolling and typing included, and Ardia turns Battery Saver on at 20 % battery or less and in Low Power Mode by default, or whenever on battery if the user picks When unplugged (Settings › Advanced; `tabLifecycle.ts`). The patch gives `BatterySaverModeManager` `HoldFullFrameRateForInput()` (frame throttling lifts at once and comes back 1 s after the last call) and `SetFullFrameRateInputInProgress()` (while true the throttling stays lifted; the second starts when it turns false). `//chrome/browser/ardia` `ac_input_frame_rate.mm` calls them from an `NSEvent` local monitor installed the first time the app calls `ac_battery_saver`: every scroll, key, mouse and gesture event holds (at most every 100 ms), and a mouse button held down (each button on its own), a key held down or a scroll gesture with its momentum is in progress until its up, its key up or its ended phase, so a pressed scrollbar track keeps paging at full rate with no further events. Battery Saver turning on during such an input starts lifted. Spans end when the app resigns active, and after 30 s at most. `ARDIA_SCROLL_FULL_RATE=off` leaves the monitor out, so Battery Saver's cap is Chrome's again. Freezing, wake-up alignment and V8's battery saver mode are untouched |
| `chromium-angle-metal-shader-cache.patch` | The framework ships ANGLE's prebuilt Metal shader cache (`gpu_shader_cache.bin`) again: Helium applies ungoogled's `fix-building-with-prunned-binaries`, which drops it from `chrome_framework_resources` |
| `chromium-ungoogled-disable-default-extensions.patch` | ungoogled's `0005-disable-default-extensions` (BSD), which Helium leaves out, without its `webstore_installer.cc` part (that part stubs out Web Store installs): no Web Store hosted app or in-app payments app among the component extensions |
| `chromium-ungoogled-disable-missing-key-warning.patch` | ungoogled's `0013-disable-missing-key-warning` (BSD), which Helium leaves out: no "Google API keys are missing" infobar |
| `chromium-ungoogled-mime-util-ymp.patch` | iridium's `mime_util-force-text-x-suse-ymp-to-be-downloaded` (BSD), which Helium leaves out: YaST one-click files download instead of rendering |
| `chromium-background-instance-no-default-handlers.patch` | A hidden test instance (`ARDIA_BACKGROUND=1`) never sets a system default: `shell_integration`'s `SetAsDefaultBrowser`, `SetAsDefaultClientForScheme` and `SetAsDefaultHandlerForUTType` log a line and return false, so chrome://settings' Make default, the default browser prompt or a default protocol handler in a scratch copy can't change the owner's defaults. The app's own Set as Default goes through `ArdiaSystem.setAsDefaultBrowser`, which does the same |
| `chromium-apple-passwords-host-skipped.patch` | Native messaging never starts Apple Passwords' helper (`com.apple.passwordmanager`): its launch constraint kills it at exec under any browser it doesn't know, which left a crash report at every connectNative of the iCloud Passwords extension once Helium's `scan-chrome-native-messaging-hosts` found its manifest in `/Library/Google/Chrome/NativeMessagingHosts`. `FindManifest` answers "Can't find native messaging host" for it |
| `chromium-ardia-layer.patch` | The macOS `//chrome:chrome_dll` (ArdiaCore's framework) links `//chrome/browser/ardia` and exports its `ac_*` calls |
| `chromium-pip-overlay-window.patch` | Chrome makes our `ArdiaVideoOverlayWindow` (`chrome/browser/ardia/pip/`, a `VideoOverlayWindowViews` subclass with its own buttons, progress bar, fade and bounds memory; the hook makes six methods virtual): Dia's video Picture in Picture window (measured in `docs/dia-spec.md` › Picture in Picture): nothing but the video at rest (the origin shows only with the controls); on hover a 35 % black scrim, back to tab (top left) and close (top right) as 28 pt rounded squares with 1 pt line glyphs, the origin centred in 13 pt, a bare play/pause glyph between bare ±10 s buttons (Chrome's, restyled; ← and → seek while they show), and a 5 pt progress bar that seeks; no previous/next track, time, mute, captions or minimize controls. The idle fade (Chrome's 2.5 s timer, rebound) skips while the pointer rests on a control. Controls fade in 200 ms ease-in-out. The window shows at once and fades out in Core Animation (100 ms from the close button, 70 ms otherwise, smooth while the tab is being shown), and a new window opens where the last one was left, sized to the new video and kept on screen (`ArdiaPictureInPicture.plist` in the user data dir). Closing it, by its button or by the window going away any other way, never pauses the video, which keeps playing in its tab, as in Dia and Arc (`OnCloseButtonPressed` asks for `kCloseWindowOnly`, and the subclass's `OnNativeWidgetDestroyed` tells the controller not to pause; Chrome paused whenever the window had a play/pause button) |

Removed, all in git history:

- With the move to Helium: `chromium-safe-browsing-off-file-types.patch` and `chromium-background-features-off.patch`
  (Helium's `fix-building-without-safebrowsing`, `disable-history-clusters`, `disable-ad-topics-and-etc`,
  `disable-live-caption-completely` and `disable-outdated-build-detector` leave the same bytes), and
  `chromium-emudhra-distrust.patch` (the owner's call: on Helium, Google's CRLSet and Chrome Root Store updates through
  `chromium-component-updater-security-only.patch` cover eMudhra, as in Chrome).
- 2026-10-15: `chromium-ui-update-before-insert.patch` and `chromium-tab-strip-notify-before-insert.patch` (CEF's guards
  for an embedder that made the Browser a tab's delegate before inserting it; ArdiaCore never does, and an instrumented
  build never hit either guard across popups, `target=_blank`, ⌘-click, `window.open`, session restore, splits and tabs
  moved between windows), `chromium-icloud-keychain-window.patch` (the tab's window is ArdiaCore's `views::Widget`, so
  Chrome's own branch hands iCloud Keychain that window) and `chromium-pip-close-keeps-playing.patch` (now
  `ArdiaVideoOverlayWindow`'s close button and `OnNativeWidgetDestroyed`).
- 2026-10-09, with CEF: `chromium-webview-native-hosted.patch`, `chromium-browser-view-hosted-fullscreen.patch` and
  `chromium-autofill-card-touchbar.patch`, which served CEF's hosted tabs and views-hosted windows. ArdiaCore has neither.
- 2026-10-08: our 18 `cef-*.patch` to CEF's own tree (the CEF runtime's API the app used before ArdiaCore, `CEF_AC_*`).
- After 0.2.19: `chromium-zz-extensions-page-uninstall.patch` (chrome://extensions uninstalled without Chrome's
  dialog), with the hidden chrome:// pages it served.
- 0.2.0: `chromium-context-menu-hosted.patch`, with the hidden "ghost" Browser windows.

## Using it

The app's build (`apps/browser/macos`) stages `out/Release_GN_arm64/Chromium Framework.framework` itself
(`packages/ardiacore/scripts/stage-framework.sh`, under the chromium lock) and embeds it (`embed.sh`). A checkout without a
Chromium tree downloads the prebuilt engine matching `engine/` instead (`packages/ardiacore/scripts/fetch-engine.sh`,
published with each release whose engine changed; `docs/releasing.md`). After an engine change, rebuild incrementally
(`scripts/agent/engine-build`, or `scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework`)
and the next app build picks it up.

## Our hooks in Chrome's code

Where our patches and `engine/ardiacore/apply.sh` let ArdiaCore decide something in Chrome's code, the hook is a
`g_ardia_*` function pointer (or flag) defined in the Chrome file that calls it; unset, Chrome behaves as stock. Each is
declared once, in `//ardia/core`'s `ac_hooks.h` (hooks in `chrome/`) or `ac_content_hooks.h` (in `content/`,
`components/`, `extensions/`, which can't see `chrome/`'s headers), and both the Chrome file and ArdiaCore include that
header (`// nogncheck`), so a signature that drifts on either side is a compile error, not a crash at the first call.
(Some changes are direct instead: `ChromeMain` making ArdiaCore's main delegate, the PiP window factory, the `CHECK`s made tolerant of a Browser without a `BrowserView`.) ArdiaCore sets the patches' hooks as
the browser process starts (`ACMainDelegate::PreSandboxStartup`), in `ardiacore::InstallChromeHooks` (`ac_seams.mm`: the
password bubble, the extension install prompt, device choosers, the Cast dialog, extension side panels, hidden
windows, windows without tabs, docked DevTools' changes, the WebContentsDelegate (H2), and `g_ardia_viewless_browsers`, which apply.sh's toast and
reading mode hooks read); apply.sh's other hooks are set next to the code they serve.

`apply.sh` also adds H1–H6, which stand where CEF's patches had seams ArdiaCore used. "Is this Browser ours" is
`WindowHost::ForBrowser`: ArdiaCore's record (`ac_browser_window.h`), made when a Browser gets one of ArdiaCore's
`ACBrowserWindow`s and dropped when its `ACWebContentsDelegate` goes in `~Browser`, after the window.

| Hook | Where | What | Replaces |
|---|---|---|---|
| H1 | `browser.cc` | With `g_ardia_browser_window_factory` set, a Browser may take the host's own `BrowserWindow` (`params.window`) without `CHECK_IS_TEST` | CEF's removed `CHECK` |
| H2 | `browser_window_features.cc` `InitPostWindowConstruction` | `g_ardia_create_web_contents_delegate` makes ArdiaCore's `BrowserWebContentsDelegate` for its Browsers | `cef::BrowserDelegate::CreateWebContentsDelegate` |
| H3 | `permission_prompt_factory.cc` | `g_ardia_create_permission_prompt` | `SetCreatePermissionPromptFunction` |
| H4 | none: `ACContextMenu` (`ac_context_menu.mm`) overrides `RenderViewContextMenuMacCocoa::Show()` | in background mode the menu goes to the host, not the screen | `RegisterMenuShowHandlerCallback` |
| H5 | `chrome_main_delegate.cc` | `g_ardia_resource_bundle_delegate`, passed where Chrome inits the shared ResourceBundle | CEF's `GetResourceBundleDelegate()` |
| H6 | `chrome_main_delegate.cc`, `chrome_browser_main.cc`, `chrome_browser_main_mac.mm`, `chrome_content_browser_client.cc`, `chrome_browser_policy_connector.cc` | `g_ardia_embedder` (set by `ACMainDelegate` in every process) skips at run time what `chrome_runtime.patch` compiled out under `ENABLE_CEF`: `InitializeUserDataDir` and startup metrics, `RecordCoreSystemProfile`, crash keys, the crash reporter and crashpad; `StartupBrowserCreator::Start` and the `RunLoop` (not a no-op under `--no-startup-window`: it sets up profiles and Chrome's own main `RunLoop`); `AppController` and `BuildMainMenu`, `didEndMainMessageLoop`; the `HandleWebUI` handler pair (it rewrites `chrome://` URLs and claims them as WebUI, so it isn't a no-op either). First run and `--make-default-browser` need no hook: `ACMainDelegate::BasicStartupComplete` gives the browser process `--no-first-run` (so `IsChromeFirstRun()` is false), `--no-default-browser-check` and `--no-startup-window`, and drops `--make-default-browser`. And no platform policy provider (`CreatePlatformProvider`), as CEF made none without a policy id: the macOS one's first load ran on the main thread before `BrowserMain`, waiting for `/usr/bin/profiles`, 10–20 ms of every launch | `chrome_runtime.patch`'s `#if !BUILDFLAG(ENABLE_CEF)` blocks; `chrome_browser_policy.patch`'s `CreatePlatformProvider` |

apply.sh also has three hooks for idle wakeups:
- `cpu_health_tracker.cc`: with `g_ardia_skip_cpu_health_sampling`, `CpuHealthTracker` gets no `CpuProbe`, so there's
  no 15 s CPU sampling. That sampling only feeds Chrome's performance-intervention toolbar button.
- `system_memory_pressure_evaluator_mac.cc`: with `g_ardia_disk_space_check_seconds`, free disk is checked at that
  period while more than 20 GiB are free, and at Chrome's 5 s otherwise.
- `extension_action_storage_manager.cc`: restored browser-action defaults notify the `ExtensionActionDispatcher`, so
  `ac_extensions_watch_actions`' watchers see them.

`ACMainDelegate::BasicStartupComplete` sets the first two (60 s) and turns on
`PartitionAllocAdaptiveMemoryReclaimInterval`. Kill switches: `ARDIA_CPU_HEALTH_SAMPLING=on`,
`ARDIA_DISK_CHECK_SECONDS=5`, `ARDIA_PA_RECLAIM=fixed`. HangWatcher stays on; `ARDIA_HANG_WATCHER=off` turns it off.

`settings_storage_quota_enforcer.cc`: with `g_ardia_lazy_storage_usage` (set by `ACMainDelegate`), a write that ignores
the quota (an extension with `unlimitedStorage`, or sync) and any `remove` or `clear` go straight to the store while
usage hasn't been counted yet, instead of first reading and re-serializing every stored value to count it. The count is
still made, from the store as it is then, when something needs it (`getBytesInUse`, a quota-checked write). When
such an op finds a corrupt value and deletes it (`VALUE_RESTORE_DELETE_SUCCESS`), it runs once more, as the scan's
deletion used to let it succeed. uBlock
Origin keeps ~30 MB in `chrome.storage.local`, and its first write of a session (its request counts, ~4 minutes after
launch) cost ~180 ms on a performance core. Kill switch: `ARDIA_LAZY_STORAGE_USAGE=off`.

Two hooks take uBlock Origin's content scripts off a restored page's request (set by `ACMainDelegate`):
- `extension_user_script_loader.cc`: with `g_ardia_script_loader_ready_at_once`, a loader made once the extension system
  is ready starts loading at once instead of posting a task first (Chromium's own TODO, crbug.com/415850597). At launch
  that posted task waited behind the early window. Kill switch: `ARDIA_SCRIPT_LOADER_AT_ONCE=off`.
- `user_script_listener.cc`: with `g_ardia_scripts_wait_at_response`, a navigation whose URL a content script wants waits
  for the scripts at `WillProcessResponse` instead of `WillStartRequest`, so its request overlaps the wait and the
  scripts still reach the renderer before the document commits. Kill switch: `ARDIA_SCRIPTS_WAIT_AT_RESPONSE=off`.

`bluetooth_adapter_mac.{h,mm}` and `bluetooth_low_energy_adapter_apple.{h,mm}`: with `g_ardia_bluetooth_poll_on_demand`
(set by `ACMainDelegate`), the Mac Bluetooth adapter polls IOBluetooth every 500 ms only while a discovery session runs.
Otherwise it polls once when something uses the adapter (any call that initializes it: `IsPowered`, `GetDevices`, a
scan…), when CoreBluetooth reports a power or permission change, and when a device connects, never sooner than
500 ms after the last poll. Chrome polls for as long as anything holds the adapter, and a page with a pending WebAuthn
request (Google's sign-in page asks for passkeys as soon as it loads) holds it through `BleAdapterManager` once the
app has the Bluetooth permission: each poll asks `bluetoothd` for the paired devices over XPC, ~2 % of a core on a
background worker, for as long as the tab is open. Kill switch: `ARDIA_BLUETOOTH_POLL_ON_DEMAND=off`.

`v2_discovery.{h,cc}` and `authenticator_request_dialog_model.cc`: with `g_ardia_hybrid_scan_on_demand` (set by
`ACMainDelegate`), the hybrid (caBLE v2) discovery listens for a phone's BLE advert only while some request's sheet shows
the QR code or a phone connecting (`kCableV2QRCode`, `kCableV2Connecting`, `kCableV2Connected`), or while it has contacted
a linked phone, instead of from the moment a request starts. Chrome starts it with every request once the app has the
Bluetooth permission, a conditional (passkey autofill) one included, so a sign-in page left open scanned for as long as it
was open, and the scan kept the adapter's 500 ms poll running. The scan stops again when no sheet shows those steps; the
request itself and its other transports are untouched. Kill switch: `ARDIA_HYBRID_SCAN_ON_DEMAND=off`.

## The offline page

Wherever Chrome would start the dino (`LocalizedError::IsOfflineError`: `ERR_INTERNET_DISCONNECTED`, or a DNS
probe that ends in `DNS_PROBE_FINISHED_NO_INTERNET`; main frames only; not with `--disable-dinosaur-easter-egg`),
`NetErrorHelper` serves `IDR_ARDIA_GAME_HTML` instead of `neterror.html`: the game from
`apps/browser/assets/offline-game`, one self-contained document (3.8 MB, brotli in `resources.pak`: CSS, scripts and
manifest inline, every WebP a `data:` URL, a CSP that allows exactly those inline blocks by hash). Its
`<script type="application/json" id="game-error">` block gets `{code, url}` of the failed load, which the game reads as
`window.GAME_ERROR`. Every other error keeps Chrome's page. A DNS probe that turns the page offline after it loaded
swaps the game's document in (`document.write`), where Chrome's page would start the dino. The page runs as Chrome's
error page, so Retry is `errorPageController.reloadButtonClick()` and the best score is Chrome's easter-egg high
score (`trackEasterEgg` / `updateEasterEggHighScore`).

The page paints itself in the tab's profile colour: the app sets `-[ArdiaCoreTab pageColor]` (WebView `pageColor`),
ArdiaCore sends it to each main frame as it is created (`ACPage.SetPageColor`, before the frame's first commit) and
again on change, and the renderer sets `window.ardiaPageColor` (and fires `ardiapagecolor`) in error pages only,
before their own scripts; web pages never see it. game.js recolours the backgrounds on a canvas as the New Tab mark is
recoloured, from `offline-game-pipeline/tint_maps.py`'s maps (`assets/bg-map`, 35 KB) and per-scene statistics.

`chrome://game` (the app's `ardia://game`) is an alias of `chrome://dino`: a simulated `ERR_INTERNET_DISCONNECTED`
whose page plays the game on its own, without the offline header. Tabs, popups and side panels share the renderer, so
all of them show it.

The resource file is generated, not patched in: `game-resource.sh` runs
`apps/browser/assets/offline-game-pipeline/inline.py` (Python standard library only) into
`components/neterror/resources/game/game.html` of the Chromium tree. `apply-chromium-patches.sh` and step 5 run it,
and `scripts/agent/engine-build` runs `inline.py` itself (it rewrites the file only when it changed), so every build ships the game folder as it is; `AC_REPO` (in `env.sh`, default the checkout `env.sh` is in, or
`~/Documents/ardia` for the step scripts' copy in `~/chromium-build/scripts`) says where the checkout is. The sprites stay at the art pipeline's 400 px: at the default zoom the front rows already draw them at
about 1:1 on a 2x screen, so 256 px sprites (about 1 MB) would be visibly soft.

## Nothing writes into the app bundle

The signature seals every file in `Ardia.app`, so the app must never write there: one added file and
`codesign --verify --deep --strict` fails ("a sealed resource is missing or invalid"), and an app on a read-only
volume or run translocated can't be written at all. A background run of a signed build, with pages, PDFs, the offline
page, chrome://settings, chrome://extensions, chrome://components and uBlock's own pages, then a diff of the bundle,
found one writer (2026-09-25):

- **declarativeNetRequest indexes next to the extension.** An extension's static rulesets are indexed into
  `<extension>/_metadata/generated_indexed_rulesets/_ruleset<N>`, a path Chrome derives from the extension's folder
  (`FileBackedRulesetSource::CreateStatic`). The ruleset checksums live in the profile's prefs, so a profile with none
  (every new profile; component extensions are never "installed") indexes again, and so does any profile whose
  indexes go stale (a new indexed format in a Chrome update). Shipping prebuilt indexes wouldn't stop the writes.
  So `ArdiaCoreContentBlocker.mm` loaded uBlock Origin Lite from a writable copy in the data directory
  (`<data dir>/Built-in Extensions`). Ardia 0.1.0 loaded uBOL straight from the bundle: its first launch wrote the six
  indexes into the bundle, and from a read-only bundle nothing was blocked at all. Its successor, full uBlock Origin
  (MV2), has no DNR rulesets, and Chrome writes nothing into its folder, so it loads straight from the signed bundle
  (`Contents/Resources/Extensions/ublock`); a copy in the data dir was code any same-user process could edit. The
  first launch of a build that loads it from the bundle deletes the old `Built-in Extensions` folder.

Everything else Chrome writes (component updater, caches, extension installs) goes to the user data dir, and
`MacAppCodeSignClone` is disabled (`ArdiaCoreHost.mm`). `scripts/release.sh` launches the exported app once and verifies
the signature again, so a new writer fails the release.

## ArdiaCore's layer: `//ardia/core`

ArdiaCore (`docs/ardiacore-spike.md`) is our own layer over Chrome. `engine/ardiacore/apply.sh` copies `engine/ardiacore/src` to
`//ardia/core` and adds its hooks: in files only Chrome's framework compiles (`chrome/BUILD.gn`'s macOS
`chrome_dll`, `chrome/app/chrome_main.cc`), H1–H6 ([above](#our-hooks-in-chromes-code)), and a few `CHECK`s made
tolerant of a Browser without a `BrowserView` (`read_anything_side_panel_controller.cc`, `sad_tab_controller.cc`…).
Run `apply.sh` again after anything that resets these files (steps 1–4). Each hook is one `hook "$src/<file>"` block that
names its own markers, lines only that edit writes: `apply.sh` skips a block whose markers are all in the file, refuses one
that is partly there, and `apply.sh --check` runs every block and names each hook whose markers or header include are
missing. `series.py check` doesn't replace it: it runs `apply.sh` itself, so a hook skipped in the tree is skipped in its
copy too. Changing or removing a hook means restoring its file from the series (`series.py check --keep <dir>` writes
the expected files) before `apply.sh` runs again.

## Our own code in the tree: `chrome/browser/ardia`

New engine code is plain Chromium code in new files. It lives in
`//chrome/browser/ardia`, calls Chrome's services directly (`PasswordStoreInterface`, `PersonalDataManager`,
`ExtensionRegistrar`, `HostZoomMap`, `TemplateURLService`, `HistoryService`…) and is exported as plain C from Chrome's
framework.

- **Where it lives.** `engine/chromium/src` mirrors `chromium/src`; `engine/chromium/apply.sh` copies it in
  (`--check` reports drift). This is ArdiaCore's convention too (`engine/ardiacore/src` → `//ardia/core`). Edit the
  repo copy only; `apply.sh` replaces the tree's.
- **Chromium's files we replace.** A file under `engine/chromium/src` outside `chrome/browser/ardia` replaces
  Chromium's at the same path (`apply.sh --paths` lists them; `series.py` counts each as the layer's). Only Chromium's
  logo, by Ardia's (`docs/brand/ardia/build.py` writes them): binary files a patch can't carry.
- **How it links.** One `source_set("ardia")` in `chrome/browser/ardia/BUILD.gn`: add your
  `ac_<domain>.{h,cc}` to its sources (sorted) and its deps.
  `chromium-ardia-layer.patch` links it into the macOS `//chrome:chrome_dll` (ArdiaCore's framework), through the
  `:exports` group that exports `_ac_*`.
- **The C surface.** `public/ac_engine.h` is plain C with the rules: exports are `ac_<domain>_<verb>`, all with one
  signature `void (const char* profile_dir, const char* args_json, ac_engine_reply_t reply, void* context)`; JSON
  object in, JSON object out (`{"error": …}` on failure); UI thread only; the reply runs once, maybe before the
  call returns. Events go to one sink (`ac_engine_set_event_sink`) as `("<domain>.<what>", {profile, …})`.
  `ac_engine.h` has the C++ side (`AC_ENGINE_CALL`, `ardia::Call`, `Reply`, `Emit`).
- **The app** includes `public/ac_engine.h` from the repo and looks each export up with `dlsym` on the engine
  framework (`packages/ardiacore/ios/ArdiaCoreEngineBridge.mm`). A missing export aborts: the app bundles an engine it wasn't built
  for. Add each new call to `docs/ardiacore-parity.md`.

## The patch series

`engine/patches/series` is the one place that says what goes into the tree and in what order: `chromium <patch>`
lines (on the tree step 3 leaves: Helium's series, its domain and name substitution and our renaming; applied in
step 4), then `layer <dir>` lines (our own files,
`<dir>/apply.sh`). Each patch is made against the tree as every line above it leaves it, and covers one concern, named
for it. A new patch goes where it belongs in the file; names no longer carry the order.

`engine/patches/series.py` does everything with it:

- `apply [--phase chromium]`: applies the series to the tree, skipping what is applied (step 4 runs it, through
  `apply-chromium-patches.sh`).
- `capture-base`: records every file the series touches as it is before the series (the base). Step 4 runs it
  just before it applies the series, so a fresh or rebased checkout records its own; `01-sync.sh` clears the old
  one. It lives in `~/chromium-build/series-base` (`AC_SERIES_BASE`).
- `check`: copies the base to a scratch directory, applies the whole series there strictly (`git apply`: exact
  context, no fuzz; each layer's `apply.sh` with `CHROMIUM_SRC` pointed at the scratch copy) and compares every
  touched file with the tree, byte for byte. Exit 0 means the series reproduces the engine we build; otherwise it
  lists each step that no longer applies and each file the series doesn't reproduce (an edit made in the tree but
  not in a patch, or the reverse), and keeps the scratch copy for `diff -u`. It writes nothing else and needs no
  lock.
- A file the series starts touching later (a new hook) needs its base too: run `capture-base` before the hook
  first goes into the tree. On an applied tree that's safe: it only records files the base lacks, never one a patch
  creates. `apply` dry-runs each patch first and refuses one that is partly in already, instead of applying its other
  hunks twice. Until then `check` takes the checkout's git HEAD for it and says so, which is right only when nothing
  upstream changes that file.
- `materialize --until <patch> <dir>`: the touched files as the series leaves them after one line. To remake a
  patch, materialize the line above it, edit a copy, and diff.
- `files`: what each line touches.

Run `check` after any patch change, before committing it. For a nightly run on this machine (a local launchd job;
nothing remote is set up), point a LaunchAgent at it, for example `~/Library/LaunchAgents/com.ardia.series-check.plist`
with `ProgramArguments` `/usr/bin/python3`, `<repo>/engine/patches/series.py`, `check`, a
`StartCalendarInterval` of 03:00 and `StandardOutPath` `~/chromium-build/logs/series-check.log`. A CI machine
needs only the repo plus a copy of the base and the tree's touched files: `CHROMIUM_SRC` and `AC_SERIES_BASE` say
where they are.

## Blocking a compromised certificate

CRLSets and Chrome Root Store updates reach the engine from Google through the component updater
(`chromium-component-updater-security-only.patch`), as in Chrome. When a compromised CA can't wait for them, it goes
into the engine itself. That was done once, for eMudhra on 2026-10-21 (`chromium-emudhra-distrust.patch`, in git
history; dropped with the move to Helium, since Google's updates cover it). Download the certificates into their own directory and,
working from outside it, compute each one's SHA-256 and SPKI SHA-256 with openssl
(`openssl x509 -noout -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256`). Check the SPKIs against
an independent published list (Go's `distrustedSPKIHashes`, Mozilla's OneCRL entries). Add the SPKIs to
`kSPKIBlockList` in `net/cert/cert_verify_proc_blocklist.inc`, without comments, and add the PEMs and a README
section to `net/data/ssl/blocklist`. One SPKI covers every cross-sign of the same key. `CRLSet::Parse` merges
that list into every CRLSet, the built-in one included, and `CertVerifyProcBuiltin` checks it against every
certificate of every valid path, locally trusted anchors too. A compromised root goes on the list by its SPKI
as well. If Chrome removes the root, also take it out of `root_store.textproto` and its PEM out of
`root_store.certs` (`root_store_tool` fails on an unused certificate). Leave `version_major` alone: Chrome
applies a component root store only if its version is strictly greater, so a bumped number freezes out
Google's real updates. Put the patch in the series (capture its files' base first), build with `engine-build`,
then check the result in a hidden instance on a train build with CDP. The bad hosts must fail and ordinary
sites must still load. A host whose root is gone fails as `ERR_CERT_AUTHORITY_INVALID` before the blocklist is
consulted, so check the blocklist itself with `engine-build --as <you> cert_verify_tool`, then
`out/Release_GN_arm64/cert_verify_tool --impls=builtin,pathbuilder --no-system-roots --roots=<root PEM>
--hostname=<host> --no-net-fetcher <served chain>`. Expect `ERR_CERT_REVOKED` from builtin and a valid path from
pathbuilder, which doesn't read CRLSets.

## Rebuilding

Everything lives outside the repo in `~/chromium-build`, which carries `.metadata_never_index`.
The step scripts are copied in `engine/patches/build/`, and each expects `~/chromium-build`. Each refuses to run
without `--apply` and the chromium lock (`scripts/agent/locked chromium`); `--help` prints its usage. Run them in the
order 1, 3, 4, 2, 5 on a fresh checkout (`gn gen` once the tree is patched). Helium's checkouts are
`~/chromium-build/helium` and `~/chromium-build/helium-macos` (`HELIUM_DIR`, `HELIUM_MACOS_DIR`), at the commits
`helium-pins.ini` names.

The live tree in `~/chromium-build` has been Helium's since 2026-10-23 (0.2.40-nightly.5's framework).

| Step | Script | Time (M5 Pro, shared machine) |
|---|---|---|
| 1. Fetch Chromium's tag (`CHROMIUM_VERSION` in `env.sh`) at depth 1 and check it out, then `gclient sync --no-history` of its deps for the Mac with the PGO profiles (`checkout_pgo_profiles`), then its hooks; clears the series base | `01-sync.sh` | ~40 min, 30 GB (deps alone, re-cloned: 7 min) |
| 2. Write `out/Release_GN_arm64/args.gn` from `gn_defines.sh`, then `gn gen` | `02-gn-args.sh` | ~1 min |
| 3. Helium, as Ardia takes it ([Helium](#helium)), in stages: `pins` (the checkouts are at the pinned commits, unmodified and made for this Chromium, and `deps.ini` downloads nothing we don't leave out), `guard`, `patches` (Helium's series, then helium-macos's, minus the skip list, with no fuzz), `fixups`, `domsub`, `namesub`, `brand-namesub`, `version`, `resources`. It runs once per tree: `.helium-stages-src`, beside the tree, records the stages that ran and refuses a second run or one that died mid-stage. Each patch's result goes to `~/chromium-build/logs/helium-patches.tsv` | `03-helium.py` | not timed on the live tree yet |
| 4. Our series: `apply-chromium-patches.sh` (`series.py capture-base` and `apply --phase chromium`: the patches, then the layers `engine/chromium/apply.sh` and `engine/ardiacore/apply.sh`) | `04-series.sh` | not timed on the live tree yet |
| 5. Regenerate the offline page (`game-resource.sh`), compile `chrome_framework` (ArdiaCore; the app's build stages it from `out/Release_GN_arm64`) | `05-build.sh` | first build 2.5 h (official, ThinLTO, PGO; 2026-10-18); incremental: the compile, then a ThinLTO relink of the framework, about 7 min (its cache, `thinlto-cache`, keeps that short) |

After a build, `helium-check-build.py` (read only) checks the framework and its paks for what we leave out of
Helium: it fails if Helium's uBlock Origin, its onboarding page or the non-free search engine data were built or
packed, or if the binary or a pak names a Helium host (`helium.computer`, `imput.net`, `services.helium`).

Disk: about 45 GB in total. That's 40 GB for the checkout with its 13 GB out dir, the PGO profiles (170 MB) and
0.2 GB for the domain-substitution cache.

Rules for editing the tree after the first build:

- **GN args** live in `gn_defines.sh`, the complete list (the args CEF's `gn_args.py` used to merge in are there
  too): an official build (`is_official_build=true`, which turns on ThinLTO and stripping) with PGO
  (`chrome_pgo_phase=2`, the profile `chrome/build/mac-arm.pgo.txt` names), no DCHECKs, no symbols, proprietary
  codecs, Widevine (DRM still needs Google's VMP signing), Ardia branding, and the flags Helium's `flags.gn` sets,
  except `enable_mdns=false` and `enable_service_discovery=false` (the Cast dialog finds devices through them).
  Helium's release build has `symbol_level=1`, for its crash reporter; we have none. `enable_rlz=true` keeps
  Widevine's storage id (`chromium-helium-rlz-for-cdm-storage-id.patch`). Official builds
  don't allow `chrome_enable_logging_by_default`, so Chrome writes no `chrome_debug.log` unless it's started with
  `--enable-logging` (a test instance: `ARDIA_CHROMIUM_SWITCHES=--enable-logging`).
  After changing them, run step 2 again.
- **Moving to a new Chromium version.** Helium tracks Chromium, so from now on a new Helium tag is a new Chromium
  version. It deletes `out/` and costs a full build (official, ThinLTO, PGO), so it needs the owner's OK.
  1. Domain substitution doesn't need reverting: its cache never matches a tree our series has patched (the revert
     fails on the hashes). Set `domsubcache.tar.gz` aside instead, and reset every repo of the checkout to its
     commit (`git reset --hard` and `git clean -ffd` in `src` and through `gclient recurse`). `01-sync.sh` runs
     `gclient sync --reset --force -D` too. Set `.helium-stages-src` aside as well: step 3 refuses a tree whose
     stages it has recorded.
  2. Set `CHROMIUM_VERSION`, `HELIUM_TAG` and `HELIUM_MACOS_TAG` in `env.sh`, and the version, tags and commits in
     `helium-pins.ini`, and check those commits out in `~/chromium-build/helium{,-macos}`. Helium's patches and
     lists are made for exactly one Chromium version: step 3's `pins` stage fails unless `env.sh`, the pins, Helium's
     `chromium_version.txt` and the tree agree.
  3. Delete `out/`, re-run `01-sync.sh`, then steps 3, 4, 2 and 5.
  4. `src` is an unmanaged, shallow solution. gclient never moves it to a new tag, and a plain `git fetch` of it
     (or of a shallow dep) asks for the whole history of every branch: the server builds that pack for an hour
     without sending a byte. So `01-sync.sh` fetches the tag itself at depth 1. If deps stall the same way
     (`STALL DETECTED`, `git fetch --prune --no-tags origin` at 0 % CPU), delete the dep checkouts listed in
     `.gclient_entries` and sync again: gclient clones them fresh at depth 1.
  5. Step 3's `guard` stage fails when a skipped patch has left Helium's series (check what replaced it) or an
     applied one now touches what a skip protects (Safe Storage, password saving, Sparkle, the product dir, mDNS);
     `GUARD_ALLOWED` in `03-helium.py` lists the hits reviewed for 0.19.4. A patch that no longer applies without
     fuzz fails `patches`, and names any skipped patch that shares its files.
  6. Our patches and the hooks may need their context refreshed; `series.py check` and `apply.sh --check` say
     which. A patch whose file moved is rewritten for the new path, and the new path's file goes into the series
     base (`series-base/`) as steps 3 and 4 left it.

## Helium

[Helium](https://github.com/imputnet/helium-chromium) is built on ungoogled-chromium. Step 3 (`03-helium.py`) applies
helium-chromium 0.19.4's series and then helium-macos 0.19.4.1's, as `patch -p1 -l -N` with no fuzz (Helium allows 2).
Helium's build-time downloads (its uBlock Origin, the onboarding page, the non-free search engine data) are never
fetched, and the hunks of its patches that edit them are left out.

**Skipped** (`SKIP` in `03-helium.py`; each is a leaf, so the rest of the series applies without it):

| Patch | Why |
|---|---|
| `helium/core/disable-password-manager` | forces password saving and passkeys off as managed prefs; Ardia uses Chrome's password manager |
| `helium/ui/remove-autofill-link-to-password-manager` | drops "Manage passwords" from the fill dropdown |
| `ungoogled-chromium/fix-building-without-mdns-and-service-discovery` | empties `DnsSdDeviceLister`; the Cast dialog needs mDNS |
| `helium/core/memory-saving-by-default` | Memory Saver would fight Ardia's own tab sleeping |
| `helium/macos/change-keychain-name` | renames the Safe Storage item; every user's passwords and cookies are encrypted with "Ardia Safe Storage" (`chromium-safe-storage-name.patch`) |
| `helium/macos/change-product-dir-name` | moves the fallback product dir to `net.imput.helium` |
| `rebel/macos/sparkle-integration`, `helium/macos/updater/{fixup-sparkle-glue,sparkle2-integration,disable-default-updater}` | Sparkle inside the framework; the app has its own updater |
| `helium/ui/crash-dialog` | a startup infobar asking to upload crashes to `crash.helium.computer` |
| `helium/core/use-system-python3`, `helium/core/rbe-nativelink-config`, `helium/macos/rbe-linux-clang-wrapper` | Helium's build setup (`.gn`'s `script_executable` would rerun every action; its remote build) |
| `helium/macos/chromium-signing` | Helium's signing flow; `scripts/release.sh` signs Ardia |

The `guard` stage checks, before anything is applied, that every skipped patch is still in Helium's series and that no
applied patch's added lines touch what a skip protects, beyond the reviewed hits in `GUARD_ALLOWED`. Some patches
can't be skipped because later ones build on them (`proxy-extension-downloads`, `spoof-extension-downloader-platform`,
ungoogled's `disable-webstore-urls` and `fix-building-with-prunned-binaries`, Helium's uBlock patches); our series
undoes what they do instead (below).

After the patches, `fixups` turns saving passwords, addresses and cards back on by default (inox's
`modify-default-prefs` turns them off); autosign-in stays off.

**Substitutions**, in this order:

- `domsub`: Helium's domain substitution, minus the Web Store and extension-updater sources in
  `domsub-keep-store.txt`, so chromewebstore.google.com, clients2.google.com and clients2.googleusercontent.com work.
  Everything else on Helium's list stays substituted. The pre-substitution copies go to
  `~/chromium-build/domsubcache.tar.gz`.
- `namesub`: Helium's `name_substitution.py --sub` and `i18n_apply.py`, unchanged: Chromium becomes Helium in the
  strings, chrome:// becomes helium://, and the translations follow.
- `brand-namesub`: `ardia_namesub.py` runs Helium's machinery again with our rules over every `.grd`, `.grdp` and
  `.xtb`: "The Helium Authors" goes back to "The Chromium Authors" (first, so "Die Helium-Autoren" becomes "Die
  Chromium-Autoren"), Helium becomes Ardia, helium:// shown to the user becomes ardia://, and links inside strings go
  back to chrome:// so they keep opening in the engine. It fails if any string still says helium or imput.
- `version`: `HELIUM_*` lines in `chrome/VERSION` equal to Chromium's own version, so Helium's version never shows.
- `resources`: Helium's icons (its generated ones made with `sips`), then `ardia_resources.txt` over them: Ardia's
  logos and product icons (`engine/chromium/src`, `engine/patches/build/ardia-icons`) and Chromium's own favicons
  for its internal pages (`engine/patches/build/chromium-originals`).

`chromium-helium-branding.patch`, first in our series, covers the literals in source these can't reach, and
`ac_strings.cc` renames "Helium" as well as "Chromium" in Chrome's strings at run time.

**Helium's services stay inert.** They sit behind Helium's services pref and its onboarding consent, and Ardia never
gives that consent: the onboarding page isn't built and the browser always starts with `--no-first-run`. On top of
that, the branding patch makes `ShouldAccessServices` false whatever the prefs say and points every services URL at an
unresolvable placeholder, and the update feed and crash upload URLs are empty. Nothing in the engine contacts a
Helium host; `helium-check-build.py` fails a build whose binary or paks name one.

**What our series undoes** (each patch is in the table above):

- `chromium-webstore-direct`: Web Store installs and extension updates go straight to Google again, not through
  Helium's proxy.
- `chromium-extension-updates` and `chromium-component-updater-security-only`: the extension and component updaters
  check Google's servers (Helium leaves their URLs empty), every component registers again, the component updater
  fetches only CRLSet, PKI Metadata and the SSL error assistant, and CUP is back on.
- `chromium-helium-ublock-off`: Helium's uBlock Origin component isn't built or loaded; Ardia runs its own
  (`fajbdaomknpkicfjcpipdmcpoamdmilh`).
- `chromium-helium-onboarding-off`, `chromium-helium-services-page-off`: no onboarding page, no services page in
  Settings.
- `chromium-helium-search-assets-off`: no non-free search engine assets.
- `chromium-helium-bangs-off`: Helium's native !bangs never fetch.
- `chromium-helium-ntp-third-party`: chrome://newtab is the third-party New Tab page again unless Google is the default
  engine.
- `chromium-helium-context-menu-cast`: the page menu keeps Cast….
- `chromium-helium-rlz-for-cdm-storage-id`, `chromium-angle-metal-shader-cache`: what Helium's applied ungoogled
  patches took that we need (Widevine's storage id input, ANGLE's Metal shader cache).

**Privacy defaults we inherit.** Where Helium's defaults differ from our ungoogled build's, Helium's win: Secure DNS is
Chromium's automatic mode (ungoogled's `doh-changes` isn't applied; Helium's `dns-providers` adds providers to the
upgrade table), WebRTC uses `default_public_interface_only` (`webrtc-default-handling-policy`), FedCM is on, and EV
certificates show as in Chrome (ungoogled's `disable-fedcm-by-default` and `Remove-EV-certificates` aren't applied).
Helium also adds fingerprinting noise (canvas, audio, hardware concurrency), HTTPS-First by default, reduced
Accept-Language headers, a Global Privacy Control pref (off by default) and flags for ECH and QUIC v2, and turns
`InfiniteTabsFreezing` on by default. Inox's prefs, Safe Browsing compiled out (`safe_browsing_mode=0`), MV2 and no
field trials are as before.

**Ungoogled patches Helium leaves out that we carry**, as `chromium-ungoogled-*` patches (BSD-3-Clause, as we
applied them before Helium): `0005-disable-default-extensions` (without its `webstore_installer.cc` part),
`0013-disable-missing-key-warning` and iridium's `mime_util-force-text-x-suse-ymp-to-be-downloaded`. Others Helium
leaves out stay out, as before: `disable-download-quarantine` (Chrome quarantines every download itself, with
`com.apple.quarantine` and its source URL in `kMDItemWhereFroms`), `prefs-always-prompt-for-download-directory`
(Chrome's default, save to Downloads without asking, is Ardia's) and `enable-extra-locales`.

### Licence and source

Helium's patches are GPL-3.0, so the engine framework built from them, and Ardia as distributed, is GPL-3.0. Our own
files stay Apache-2.0. Our patches that change Helium's code say so in their `SPDX-License-Identifier: GPL-3.0-only`
header; the ones carried from ungoogled-chromium keep `BSD-3-Clause`.

Every release links its Corresponding Source: the repo at its tag, plus `ArdiaCore-<tree>-source.tar.xz`, which
`scripts/release.sh` packs with `scripts/engine-source.sh` for each new engine. It holds Helium's two tags, the
onboarding and uBlock Origin versions Helium's `deps.ini` pins, and where Chromium's tag and source tarball are.
chrome://credits keeps Helium's entry (`third_party/helium`). Helium's name appears nowhere else in the UI.

## Tab capture

A page that calls
`getUserMedia({video: {mandatory: {chromeMediaSource: "desktop", chromeMediaSourceId: id}}})`
captures the tab behind `id`; Chromium's `DesktopMediaID::Parse` already understands the id. Asking
for `audio: {mandatory: {chromeMediaSource: "desktop"}}` gets that tab's audio instead of system
audio. Capturing reads Chromium's own compositor frames, so macOS asks for no Screen Recording
permission.

In the app:

- The WebView method `mediaCaptureSourceId()` returns the id.
- The share picker answers a `displayMediaRequest` with that id and whether to share audio, and the page
  script asks for desktop audio when the answer says so.
- What audio the picker offers follows Chrome's picker: tab audio (checked by default), system audio for a
  screen, and for a window system audio, or the app's own audio when the page asks `windowAudio: "window"`
  (both unchecked by default). `systemAudio: "exclude"` and `windowAudio: "exclude"` hide the checkbox. System
  audio needs Core Audio taps (macOS 14.2+, `DesktopMediaPickerController::IsSystemAudioCaptureSupported`), app
  audio also `kApplicationAudioCaptureMac` (`media::IsApplicationLoopbackCaptureSupported`); the engine reports
  both (`ArdiaCoreEngine.desktopCaptureAudio`). macOS asks for System Audio Recording the first time
  (`NSAudioCaptureUsageDescription`).
- The answer lets one getUserMedia request of the asking frame, within 15 s, capture exactly the picked
  source (`ac_desktop_capture.mm`), with the audio it was granted: `audio_share` for a tab or screen, and a
  window's `window_audio_type` (`chromium-desktop-capture-window-audio.patch` lets Chrome's handler pass that
  on). Anything else is refused: the page script runs in the page's world, so the page decides what
  getUserMedia asks for, and audio it wasn't granted never reaches it.
- Desktop getUserMedia without a picked source is refused outright, with no prompt (as in Chrome, where
  only `getDisplayMedia` and its picker capture the screen). Only camera and microphone get a permission
  prompt.

Verified in the app: a "Tab" track at 1558×1080 delivering frames, plus a "Tab Audio" track.

## CEF's 117 patches

What became of each patch in CEF 154's `patch/patches` (branch 8037) when CEF left the tree. "Dropped" means
ArdiaCore doesn't need it: it serves a platform we don't ship, off-screen rendering (OSR), CEF's Alloy runtime, CEF's
own API, Views or build, or crash upload.

| Patch | Now |
|---|---|
| `angle_commit_config` | dropped (CEF source tarballs) |
| `base_command_line_1872` | dropped (CEF API: lower-case switch names) |
| `base_logging_3951` | dropped (Windows bootstrap) |
| `base_rand_util_lazy_seed` | dropped (Windows DCHECK builds) |
| `base_test_4396276` | dropped (CEF's test binaries) |
| `base_thread_pool_5548577` | dropped (CEF's multi-threaded message loop; Windows/Linux only) |
| `blink_ax_viewport_collapse` | dropped (CEF API: accessibility tree collapse) |
| `blink_web_element_4200240` | dropped (CEF API) |
| `blink_window_size_3714` | dropped (CEF's Document PiP options) |
| `browser_scheduler` | dropped (multi-threaded message loop shutdown) |
| `browser_security_policy_1081397` | dropped (CEF's custom schemes) |
| `chrome_autofill_bubble_3796` | folded (`chromium-autofill-address-bubble-window`) |
| `chrome_browser` | dropped (CEF build) |
| `chrome_browser_browser` | hook (H1, H2); folded (`chromium-cef-carryover`: `DeleteBrowser` order, the tab strip API's colour provider without an active tab; its `browser_ui_controller` guard against a tab that loads before it's in the strip, kept as `chromium-ui-update-before-insert` until 2026-10-15, dropped with it); rest dropped |
| `chrome_browser_content_settings` | dropped (a `NOTREACHED` only CEF's tests hit) |
| `chrome_browser_context_menus` | dropped (H4 is `ACContextMenu::Show()`) |
| `chrome_browser_devtools_osr` | dropped (OSR) |
| `chrome_browser_dialogs_jsmodal` | dropped (Alloy, OSR) |
| `chrome_browser_dialogs_misc` | dropped (OSR; CEF's toolbar-less extension dialog anchor) |
| `chrome_browser_dialogs_native` | dropped (CEF API: file dialog interception) |
| `chrome_browser_dialogs_widget` | dropped (OSR dialog parents, CEF Views) |
| `chrome_browser_download` | dropped (CEF API: download delegate) |
| `chrome_browser_extensions` | dropped (Alloy tabs API, CEF's PDF viewer delegate) |
| `chrome_browser_extensions_background` | folded (`chromium-cef-carryover`: `gn gen` asserts without it, given `enable_background_mode=false`) |
| `chrome_browser_frame_mac` | dropped (CEF Views) |
| `chrome_browser_metrics_tpm_476896967` | dropped (a Windows TPM driver crash) |
| `chrome_browser_permission_prompt` | hook (H3) |
| `chrome_browser_policy` | dropped (CEF API: policy configuration) |
| `chrome_browser_printing_oop_osr` | dropped (OSR) |
| `chrome_browser_privacy_1119417` | dropped (CEF build; Windows/Linux) |
| `chrome_browser_profile_menu` | dropped (Chrome's profile menu, which ArdiaCore never shows) |
| `chrome_browser_profiles` | dropped (CEF's incognito request contexts) |
| `chrome_browser_safe_browsing` | dropped (component build) |
| `chrome_browser_startup` | dropped (CEF API: process singleton) |
| `chrome_browser_task_manager` | dropped (multi-threaded message loop shutdown) |
| `chrome_browser_views_dangling_rawptr` | dropped (Chrome's toolbar, which ArdiaCore never shows) |
| `chrome_browser_webui_license` | dropped (CEF's chrome://license) |
| `chrome_browser_webui_version` | dropped (CEF's chrome://version) |
| `chrome_common_logging` | dropped (CEF build: logging on in Release) |
| `chrome_plugins` | dropped (CEF API) |
| `chrome_renderer` | dropped (CEF build) |
| `chrome_renderer_print_preview` | dropped (CEF API: per-frame print preview) |
| `chrome_runtime` | hook (H5, H6); its `ConfigureNetworkContextParams` `bool` return and `CleanupOnUIThread` dropped |
| `chrome_runtime_views` | dropped (CEF Views) |
| `color_provider_manager_3610` | dropped (CEF Views) |
| `component_build` | dropped (component build) |
| `component_updater_4087` | dropped (CEF API: component updater) |
| `components_gcm_disable` | dropped (ungoogled's `disable-gcm` now applies in full) |
| `config_3892` | dropped (CEF API: preferences and variations) |
| `content_2015` | dropped (ArdiaCore's `ConfigureNetworkContextParams` is `void` again) |
| `content_main_654986` | dropped (CEF's split `ContentMain`; ArdiaCore starts through `ChromeMain`) |
| `content_throttle_registry` | dropped (CEF API) |
| `crashpad_1995` | dropped (CEF's crash reporting; crashpad stays off) |
| `crashpad_tp_1995` | dropped (crash upload) |
| `dawn_dxil_redist` | dropped (Windows) |
| `devtools_ai_assistance_skills` | dropped (CEF build: DevTools' AI assistance bundle) |
| `embedder_product_override` | dropped (CEF API: User-Agent product) |
| `gn_config` | dropped (CEF build) |
| `gritsettings` | dropped (CEF build) |
| `libxml_visibility` | dropped (CEF build) |
| `light_mode_3534` | dropped (CEF's force-light/dark mode switches) |
| `linux_assets_path_1936` | dropped (Linux) |
| `linux_atk_1123214` | dropped (Linux) |
| `linux_chrome_widevine_3149` | dropped (Linux) |
| `linux_glib_deprecated_volatile` | dropped (Linux) |
| `linux_gtk_theme_3610` | dropped (Linux) |
| `linux_gwp_asan_3803` | dropped (Linux) |
| `linux_printing_context` | dropped (Linux) |
| `mac_chrome_locale_3623` | folded (`chromium-cef-carryover`: only `LoadLocalState`'s ResourceBundle delegate, for H5); its Mac UI locale from Local State dropped (Chrome's own on the Mac: Cocoa's, `en-US` for Ardia's bundle either way) |
| `mac_event_observer_2539` | dropped (CEF's own `NSApplication`; ArdiaCore runs Chrome's) |
| `mac_fling_scheduler_2540` | dropped (OSR) |
| `mac_keyboard_conversion_1467329` | folded (`chromium-cef-carryover`) |
| `mac_platform_style_bubble_893292` | folded (`chromium-cef-carryover`: `kAdjustBubbleIfOffscreen`); its `profile_menu_view_base.cc` hunk dropped (Chrome's profile menu, which ArdiaCore never shows) |
| `mac_print_preview_modal` | folded (`chromium-cef-carryover`: child-modal resize and focus); its Save as PDF file dialog policy dropped (`PdfPrinterHandler::SelectFile` already checks it) |
| `mac_render_widget_3680` | dropped (CEF Views: `acceptsFirstMouse`) |
| `message_loop` | dropped (Windows; multi-threaded message loop) |
| `metrics_system_profile` | dropped (multi-threaded message loop) |
| `mime_handler_view_guest_1565_2727` | dropped (OSR) |
| `mojo_connect_result_3664` | dropped (CEF API) |
| `net_cookie_flags` | dropped (CEF API: per-request cookies) |
| `net_test_server_3798752` | dropped (tests) |
| `net_url_request_3596` | dropped (CEF's custom schemes) |
| `osr_fling_2745` | dropped (OSR) |
| `osr_win_remove_keyed_mutex_2575` | dropped (Windows OSR) |
| `printing_context_2196` | dropped (Linux) |
| `raw_ptr_3239` | dropped (CEF's directory listing) |
| `renderer_host_1070713` | dropped (CEF API: background colour) |
| `renderer_host_aura` | dropped (Aura: Windows/Linux) |
| `resource_bundle_2512` | dropped (CEF's threading) |
| `rfh_navigation_4829483` | dropped (CEF's custom schemes and window callback) |
| `runhooks` | dropped (Windows toolchain) |
| `screen_1443650` | dropped (`Screen::*RectInWindow` has only Aura and Windows callers) |
| `services_network_2622` | dropped (CEF API: cookieable schemes) |
| `services_network_2718` | dropped (the `bool` `ConfigureNetworkContextParams`) |
| `set_resize_background_color` | dropped (CEF Views) |
| `tarball_deps` | dropped (CEF source tarballs) |
| `tarball_gclient` | dropped (CEF source tarballs) |
| `trace_event` | dropped (CEF's trace categories) |
| `ui_base_x11_util` | dropped (Linux) |
| `ui_dragdrop_355390` | dropped (Linux) |
| `ui_menu_model_3577` | dropped (CEF menus) |
| `ui_views_widget_type` | dropped (CEF Views; Linux) |
| `v8_build` | dropped (CEF build) |
| `views_1749_2102_3330` | dropped (CEF Views and menus) |
| `views_textfield_5399416` | dropped (CEF Views) |
| `views_widget` | dropped (CEF Views: external parents; mostly Windows/Linux) |
| `viz_capture_3826` | dropped (OSR) |
| `viz_osr_2575` | dropped (OSR) |
| `web_contents_1257_1565` | dropped (OSR, CEF API) |
| `webkit_move_pip` | dropped (CEF's Document PiP options) |
| `webkit_plugin_info_2015` | dropped (CEF API) |
| `win_app_icon_3606` | dropped (Windows) |
| `win_ax_platform_node` | dropped (Windows) |
| `win_sandbox_3210` | dropped (Windows) |
| `win_shell_dialogs_3294` | dropped (Windows) |
| `win_taskbar_decorator_3645` | dropped (Windows) |
| `win_taskbar_group_3641` | dropped (Windows) |
