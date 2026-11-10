# Password managers

Ardia fills logins from 1Password, Bitwarden (bitwarden.com, bitwarden.eu, self-hosted servers and Vaultwarden) and
Proton Pass. It talks to each one through the vendor's own command-line tool (`op`, `bw`, `pass-cli`), so Ardia never
implements a vault format, never syncs a vault and never keeps a copy of one.

## Architecture

```
apps/browser (JS)                       packages/ardiacore/ios (Swift, module ArdiaVaults)
  platform/vaults.ts  ── call("vaults.*") ──>  VaultsModule ──> VaultBroker (actor)
                      ── signIn / unlock ──>                      │  item cache, per-provider lanes,
                      <── vaults.changed ───                      │  state cache, fill and save checks
                      <── vaults.itemsChanged                     v
ArdiaWebView+PageTab ── fillValues / save ──────────────> VaultRegistry.providers
                                                           OnePasswordVault, BitwardenVault, ProtonPassVault
                                                                  │  (protocol VaultProvider)
                                                                  v
                                                           VaultCLI ──> VaultCommand ──> Process (op, bw, pass-cli)
```

| File | Role |
| --- | --- |
| `VaultsModule.swift` | The Expo module `ArdiaVaults`: the `vaults.*` call table, the `vaults` event channel, and the two secret-taking functions `signIn(provider, fieldsJSON)` and `unlock(provider, password)`. |
| `VaultBroker.swift` | The one actor every caller goes through. Caches provider states and item lists (served at once, refreshed in the background after 60 s), serialises every CLI call per provider through a `VaultLane`, emits `vaults.changed` and `vaults.itemsChanged`, and runs the fill and save checks. |
| `VaultProvider.swift` | The protocol a manager implements, plus shared helpers (`makeState`, `signedIn`, `needs`, `failed`, `checked`). |
| `VaultRegistry.swift` | The list of managers. |
| `VaultCLI.swift` | One resolved binary plus its environment and the provider's slice of the session store. Providers only ever run commands through it. |
| `VaultCommand.swift`, `VaultCommandResult.swift` | The hardened process runner. |
| `VaultBinaryLocator.swift` | Where binaries may live, and the ownership and permission check. |
| `VaultSessionStore.swift`, `VaultKeychain.swift`, `VaultOwnerCheck.swift` | Sessions in memory, the optional Touch ID copy, the idle clock, scratch values and preferences per provider, and the running long command (Proton's browser sign-in). |
| `VaultAutoLock.swift` | Locks every manager on sleep, screen lock and fast user switch (unless Lock When Screen Locks is off), checks the idle timeout every minute, and records the quit for `VaultLockPolicy`. |
| `VaultLockPolicy.swift` | The two lock options, the managers open right now, and the unlocked-at-quit marker. |
| `VaultExport.swift` | Export Passwords: a CSV written natively from the store, after an owner check. |
| `VaultOriginMatch.swift` | Pure origin matching (no state, Foundation only). |
| `VaultClipboard.swift`, `VaultPasswordGenerator.swift`, `VaultTotp.swift` | Concealed clipboard copy, strong passwords, one-time code timing. |
| `VaultGenerated.swift`, `VaultsGeneratedModule.swift`, `ArdiaWebView+VaultGenerated.swift` | Generated passwords that aren't saved in a manager yet: the sealed `Generated.vault`, its calls, the fill from it and the save popover's password drafts. |
| `VaultPasswordFieldView.swift` | The save popover's password field (`ArdiaVaultPasswordField`), editing a native draft of the captured password. |
| `VaultJSON.swift`, `VaultMessages.swift` | Defensive JSON reading and error text cleanup shared by every provider. |
| `Vault*.swift` value types | `VaultProviderState`, `VaultItem`, `VaultSignInResult` and friends: Codable mirrors of the TS types in `packages/ardiacore/src/vaults.ts`. |

### State

Each manager reports one of `notInstalled`, `signedOut`, `locked`, `unlocked`, `unavailable`. "Unlocked" is Ardia's
own gate on top of the CLI: a manager is unlocked only while the session store holds a session for it.

- Bitwarden: the session is the real `BW_SESSION` key from `bw unlock`.
- 1Password: the session is a marker set after the 1Password app approved a call (Touch ID in 1Password).
- Proton Pass: the session is a marker set after a sign-in, or after the Mac owner check on unlock.

Lock forgets the session; sign out also tells the CLI to log out. When a CLI reports that the vault is locked or signed
out, the broker drops the session and the cached items and publishes the new state.

### The local store

`VaultCache.swift` is Ardia's own encrypted password store: one AES-GCM sealed file per manager in
`<data dir>/Password Managers/Cache/<id>.vault` (0600, excluded from backups). It holds the item list and each login's
password and one-time-code secret (Bitwarden's `login.totp`, Proton's
`totp_uri`). Everything a fill, a copy or a code needs is read from it in memory, so none of them waits for a CLI.

- **One unlock for all of it.** While a file exists, a locked manager's Unlock (and the menu's Unlock row) asks for
  Touch ID or the Mac password once (`VaultOwnerCheck`) and opens every manager's file. The manager then reads as
  `unlocked` even with no CLI session; the CLI sessions come back in the background from the stored Bitwarden key or
  Proton's marker, without a second prompt (`VaultOwnerCheck.recentlyConfirmed`, 30 s). 1Password reconnects only when
  something needs its CLI (a 1Password code, a save, Sync), since that asks its own app. A manager unlocked through
  its CLI (master password, 1Password's app) opens the store too.
- **Codes are made on the Mac.** `VaultTotpSecret` reads an `otpauth://` URI or a bare base32 secret (SHA-1, SHA-256
  or SHA-512, 6 to 8 digits, any period) and computes the RFC 6238 code; it is checked against RFC 6238's vectors.
  1Password's list has no secrets, so its first code reads the item once (`op item get --format json`), keeps the OTP
  field's `otpauth://` URI in the store and makes every later code here. Steam and other non-TOTP schemes still ask the
  CLI; one fetch per item runs at a time, and a code just fetched is reused for a fill while more than 3 s remain.
  The fill menu fetches codes as soon as it opens on a code field, and right after a login with a known code fills.
  A code row for the login just filled on the site counts as the person's choice, so a code step on a sibling
  subdomain fills; a split code (one box per digit) is typed box by box, focusing each one first.
- **Freshness.** A list older than 60 s is refreshed in the background from the CLI when a session exists, and the file
  rewritten. A cached password or code secret is used only while its item's `updatedAt` is unchanged.
- **Locking.** Lock After, the screen locking and sleep close the store and drop everything in memory; Lock on one
  manager hides that manager while the others stay open. Lock When Screen Locks (`vaultLockOnScreenLock`, default on)
  off keeps the store open through sleep, screen lock and fast user switch; Lock After still applies.
- **Quitting.** The store always starts closed, unless Lock When Ardia Quits (`vaultLockOnQuit`, default on) is off.
  Then, when Ardia quits with the store open and Touch ID allowed, `VaultLockPolicy.recordQuit` writes an
  `unlocked-at-quit` marker through `VaultKeychain` (data-protection keychain, this device only) naming the open
  managers and the Mac's boot time. At launch `VaultsModule`'s `OnCreate` runs `VaultBroker.resumeAfterQuit`, which
  reads and deletes the marker, and only on the same boot opens the store, publishes those managers as unlocked and
  restores their CLI sessions from the stored keychain sessions without a prompt, before the first menu. A restart,
  turning the option back on, Lock, Lock All and the idle lock delete the marker. Sign Out deletes its file here and in iCloud; a CLI
  reporting signed out, or a different account, deletes only this Mac's file.
- **The key.** A random 256-bit key in the data-protection keychain under the app's `…​.passwords` access group,
  synchronizable, so iCloud Keychain carries it to the owner's other Macs. Builds without that entitlement (and the
  older cache key, `vault-cache-key` in the login keychain, which is migrated) keep a local key; a hidden test instance
  uses its sandbox file.
- **iCloud.** With Sync with iCloud on (`vaultICloudSync`, on by default) and a synced key, each sealed file is also
  written to `iCloud Drive/Ardia/Password Managers/<id>.vault` when its contents change. When the store opens, and on
  Sync, a copy there newer than this Mac's replaces it; a copy iCloud hasn't downloaded yet is left for next time, so an
  unlock never waits on iCloud. Turning the setting off removes Ardia's files from iCloud Drive. A hidden instance syncs
  only to a folder given as the `vaultCloudDirectory` test value.
- **Sync.** Settings › Passwords › Password Managers › Sync Now (`vaults.sync`) unlocks first if everything is locked,
  pulls iCloud, forces each connected manager's CLI to sync (Bitwarden's 5-minute `bw sync` throttle is skipped) and
  pushes the result to iCloud. The row shows when the store last synced.

`vaults.providers` answers at once from the cached states (or a placeholder: `notInstalled` when no binary is found,
otherwise `locked`) and starts one background refresh, which emits `vaults.changed` for each state that differs.

## Security model

1. **Secrets stay native.** Passwords, saved form passwords, master passwords, API keys and session keys never reach
   JS, an event payload or a log. JS sees item metadata (id, title, username, urls, hasTotp, vault name) and one-time
   codes. Error text from a CLI is reduced to its first line, stripped of log prefixes, capped at 240 characters, and
   any secret Ardia passed to that command is replaced with `[hidden]`.
2. **Fill checks.** `VaultBroker.fillValues` refuses unless the origin is https (or http on localhost, 127.0.0.1 or
   ::1), the manager is unlocked, the item exists in a fresh list, and one of the item's URLs matches the origin
   (`VaultOriginMatch`: same host, or one host is a dot-suffix subdomain of the other; IP addresses match exactly; a
   single-label host never matches by suffix; a registry suffix such as `co.uk` or a shared-hosting suffix such as
   `github.io` never matches by suffix, and a host under shared hosting matches only exactly; an explicit port in the
   saved URL must equal the page's port; the JS ranking in `state/vaults/originMatch.ts` uses the same lists). The
   person choosing an item from search (`userChose`) skips only the URL match, never the https rule. The origin
   comes from the native VerifiedOrigin of the frame, and the page script checks `location.origin` again at fill time.
3. **Binaries.** Only fixed locations are searched (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`,
   `~/.npm-global/bin`, `/opt/local/bin`, `~/bin`). The path, its directory, the resolved target and the target's
   directory must be owned by root or the current user and not be world-writable, and the target must be a regular
   executable file. Commands never go through a shell.
4. **Processes.** Each run gets an explicit environment: `HOME`, `USER`, `LOGNAME`, `TMPDIR`, proxy and CA variables
   when set, `LANG=en_US.UTF-8` (so error text is parseable), `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, then `/opt/homebrew/bin` and `/usr/local/bin` when they pass the
   locator's directory checks (so an npm-installed `bw` finds `node`), then the binary's own directory, and the
   provider's variables. Stdin is `/dev/null`, or a pipe that is written and closed (with
   `SIGPIPE` off for that descriptor). Stdout and stderr drain concurrently; stdout is capped at 32 MB (the process
   is stopped past it) and stderr at 1 MB. Every call has a timeout: terminate, then `SIGKILL` 2 s later. Flags take
   their values in `--flag=value` form so an id or title can't be read as an option, and ids are validated before
   they reach argv.
5. **Secrets in argv: never.** Master passwords go through `bw --passwordenv` in that one process's environment, API
   keys through `BW_CLIENTID`/`BW_CLIENTSECRET`, Proton tokens through `PROTON_PASS_PERSONAL_ACCESS_TOKEN`, and new
   logins as JSON (or base64 JSON for `bw`) on stdin. The one exception is a Bitwarden two-step code, which `bw` takes
   only as `--code`; it is short-lived.
6. **One call at a time per manager.** Every CLI call runs inside that manager's `VaultLane`, so two callers never
   race the same CLI (or invalidate each other's `bw` session). Concurrent item list requests share one fetch.
7. **Touch ID copy (Bitwarden).** With the Touch ID option on, the session key is also written to the login keychain
   (service "Ardia Password Managers", `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` where accepted). Reading it back
   first passes `LAContext` (biometrics, falling back to the Mac password), and the key is checked with `bw status`
   before use. Any keychain failure degrades to memory only. This path needs no entitlement, so it works in ad-hoc
   and development signed builds. Turning the option off deletes every stored copy, and lock then also runs `bw lock`.
8. **Auto-lock.** After the idle timeout (default 30 minutes without a list, fill, copy, code or save), and on sleep,
   screen lock or fast user switch (while Lock When Screen Locks is on), every manager locks and `vaults.changed` is
   emitted. Sleep, screen lock and fast user switch also wipe every tab's captured logins
   (`ArdiaVaultCapture wipeAll`) when they lock.
9. **Owner check before passwords.** With Ask Before Filling on (the default, `vaultAskBeforeFilling`, sent as
   `askBeforeFilling` in `vaults.setOptions`), `VaultBroker.fillValues` refuses any fill that includes a password, and
   `copy` refuses a password copy, until the Mac owner confirms with Touch ID or the login password
   (`VaultOwnerCheck`). A refused fill answers `notAuthorized` and the menu stays open with no error; a refused copy
   answers `declined` and shows no toast. Usernames and one-time codes don't ask. The fill menu also shows Apple's
   embedded Touch ID view (`VaultTouchIDView`, `LAAuthenticationView`) on the selected login, or the first one: a
   touch on the sensor grants the broker one owner check for 10 s (`VaultOwnerCheck.grant`) and reports `granted` through the view's `onStatus`; JS fills
   the row that was armed at the moment of the match (`state/vaults/touchID.ts`), with no dialog, and asks the page to
   submit the form (`submit: true`); a click or Return never submits. It is one touch per step: on a username-only
   page the touch fills the username and continues, on the password page the password, and on the code page the code
   (code rows are touch rows too). A touch on a locked manager's Unlock row opens the store and fills the login that
   then rests selected with the same touch (the broker grants again after the unlock); a click on Unlock does the same
   without submitting. The view reports `onStatus` (`ready` while the
   sensor listens, `retry` after a finger that didn't match, `granted`, and the terminal `unavailable` and
   `lockout`), which the row shows as the glyph, a red shake with Try Again, and a check. It listens only while the
   app is active and its window is key, re-arms after a system cancel (backing off to 2 s after five in 3 s), and
   ignores replies from an older attempt. Apple's glyph is drawn transparent and the row shows
   the `touchid` symbol in its own text colour instead. Without Touch ID, or after a lockout, Return or a click asks through the system prompt instead.
   `vaults.biometrics` says whether Touch ID can be used.
10. **Clipboard.** Only usernames and passwords are ever copied; one-time codes are filled, never copied. Copies are marked `org.nspasteboard.ConcealedType` and `org.nspasteboard.TransientType`, and the
   pasteboard is cleared after 90 s if nothing else was copied since. Every copy (the command bar's Copy Username and
   Copy Password, and both buttons in Settings › Passwords' login sheet) goes through `vaults.copy`, which answers
   `copied` only once the pasteboard reads the value back; otherwise `declined` (the owner check was refused) or
   `error` (`locked`, `notFound`, `clipboard`, ...), shown as a toast or under the sheet. The command bar copies the
   login filled in that tab, else the one used last on the site, else the best match.
11. **Test instances.** In a hidden test instance (`ARDIA_BACKGROUND=1` with `ARDIA_DATA_DIR`, `VaultSandbox`), binaries are looked up only in `<data dir>/Password Managers/bin`,
    each CLI gets its own state folder under `<data dir>/Password Managers/<id>` (`OP_CONFIG_DIR`,
    `BITWARDENCLI_APPDATA_DIR`, `PROTON_PASS_SESSION_DIR` with the file key provider), and the keychain copy goes to
    `<data dir>/Password Managers.json` (0600) instead of the real keychain. In background mode the owner check never
    prompts (it answers from `ARDIA_TEST=reauth=granted`) and the Touch ID view draws its glyph without arming, copies go to a private pasteboard, and sleep or screen lock
    of the owner's Mac doesn't lock the test's vaults.

### Known limits

- Bitwarden items with master password re-prompt are left out of the list, because the CLI can't honour re-prompt.
- Bitwarden's new-device email code has no CLI flag; the sign-in error suggests the personal API key instead.
- A changed password for a login that's already saved isn't written back: providers can create logins but not edit
  them, so a change-password submission for a saved username saves nothing.
- A Proton Pass session lock can only be lifted with `pass-cli session unlock` in Terminal.
- 1Password's list has no one-time code flag, so `hasTotp` is unknown there and `vaults.totp` answers `null` when the
  item has none.
- Origin matching uses a short built-in suffix list, not the full public suffix list: a registry suffix missing from it
  (and not of the `co.xx` form) could match its subdomains.

## The JS surface

Calls (`call("vaults.<name>", args)`, typed in `packages/ardiacore/src/engine/api.ts`):

| Call | Args | Returns |
| --- | --- | --- |
| `providers` | `{}` | `VaultProviderState[]` |
| `refresh` | `{provider}` | `VaultProviderState` (drops the item cache, forces a Bitwarden sync next list) |
| `items` | `{provider?}` | `VaultItem[]` (empty for a locked manager) |
| `lock`, `signOut`, `cancelSignIn` | `{provider}` | `VaultProviderState` |
| `configure` | `{provider, server?}` | `VaultProviderState` (`message` says why a change was refused) |
| `copy` | `{provider, id, field: "username" \| "password"}` | `{copied, clearsAfter}` |
| `totp` | `{provider, id}` | `{code, period, expiresAt} \| null` |
| `generate` | `{style?, maxLength?}` | `{length}` |
| `setOptions` | `{idleLockMinutes, touchID, askBeforeFilling, iCloudSync, lockOnQuit, lockOnScreenLock}` | `{}` |
| `listGenerated` | `{}` | `{id, origin, username, createdAt, submitted}[]`, newest first, never the password |
| `copyGenerated`, `deleteGenerated` | `{id}` | like `copy`; `{deleted}` |
| `saveGenerated` | `{id, provider, username?}` | `{saved, item?, error?}` (`error: "needsUsername"` when neither the entry nor the call has one) |
| `setGeneratedRetention` | `{days}` | `{}` (`-1` Until Deleted, `0` Never) |
| `export` | `{provider}` | `{saved, count, declined}`: the CSV (`name,url,username,password,otp`, RFC 4180) goes straight to the file picked in a save panel (0600); passwords never reach JS. A hidden test instance writes `<data dir>/<Manager> Passwords.csv` and logs the path |

Secret functions (`packages/ardiacore/src/vaults.ts`): `signInToVault(provider, fields)` and
`unlockVault(provider, password | null)`, both resolving to a `VaultSignInResult`. Sign-in fields per manager:

- 1Password: `{account?}`. There is no password; the 1Password app approves with Touch ID.
- Bitwarden: `{server?, email, password, method?, code?}` or `{server?, clientId, clientSecret, password?}`. A result
  with `needs: "code"` and `methods` asks the person to pick a method (`"0"` authenticator, `"1"` email,
  `"3"` YubiKey) and send it back as `method`; choosing email sends the email and asks for the code.
- Proton Pass: `{password?}` starts the browser sign-in; the result has `needs: "approval"` and `approvalURL` to open
  in a tab, and `vaults.changed` follows when the CLI finishes. `{method: "accessToken", clientSecret: token,
  password?}` signs in with a personal access token. `password` is the optional extra Pass password.

`unlockVault(provider, null)` means Touch ID: the Bitwarden keychain copy, 1Password's app, or the Mac owner check
for Proton Pass.

Events: `vaults.changed` `{provider: VaultProviderState}`, `vaults.itemsChanged` `{provider}` and `vaults.generatedChanged` `{}`.

## Adding a password manager

A new manager is one Swift file, one registry line and one row in the JS brand table.

1. **Learn the CLI.** Find where it installs, how it reports signed in and locked, which commands list logins and
   fetch one secret, how it creates a login, and which commands can wait for a person (a prompt, a browser, Touch ID).
   Find a way to pass every secret through the environment or stdin.
2. **Create `packages/ardiacore/ios/<Name>Vault.swift`** with a struct that conforms to `VaultProvider`. Keep it
   stateless: anything a manager needs to remember goes through `VaultCLI` (`remember(session:)`, `value`/`setValue`
   for values that last until the next refresh or lock, `preference`/`setPreference` for values that last until sign
   out).
3. **Map errors with `checked`.** Give it the lowercase substrings that mean locked, signed out and not found;
   everything else becomes a cleaned, redacted failure message.
4. **Parse defensively** with `VaultJSON` (missing fields, numbers as strings, dates in any of the common forms) and
   build `VaultItem`s with metadata only. Drop secret fields as soon as you've read what you need.
5. **Add it to `VaultRegistry.providers`.**
6. **Add its brand row in the JS table** (name, icon) next to the existing three.
7. **For test instances**, return the CLI's state-folder variable from `isolatedEnvironment(_:)` so a hidden instance
   never touches the person's real session.

```swift
import Foundation

struct ExampleVault: VaultProvider {
  let id = "example"
  let name = "Example"
  let binaryName = "example-cli"
  let capabilities = VaultCapabilities(totp: true, save: false, selfHosted: false, masterPassword: true, touchID: false)
  let install = VaultInstall(command: "brew install example-cli", url: "https://example.com/cli")
  let setup: VaultSetup? = VaultSetup(kind: .credentials)

  private static let tool = "Example CLI"

  func isolatedEnvironment(_ directory: String) -> [String: String] { ["EXAMPLE_CONFIG_DIR": directory] }

  func state(_ cli: VaultCLI) async -> VaultProviderState {
    let result = await cli.run(["status", "--json"])
    guard result.succeeded, let status = VaultJSON.dict(VaultJSON.parse(result.stdout)) else {
      return makeState(.unavailable, message: VaultMessages.failure(result, tool: Self.tool))
    }
    guard VaultJSON.bool(status["signedIn"]) == true else { return makeState(.signedOut) }
    return makeState(cli.session == nil ? .locked : .unlocked, account: VaultJSON.string(status["email"]))
  }

  func signIn(_ cli: VaultCLI, fields: VaultSignInFields) async -> VaultSignInResult {
    await unlock(cli, password: fields.password)
  }

  func unlock(_ cli: VaultCLI, password: String?) async -> VaultSignInResult {
    guard let password else { return needs(.password) }
    let result = await cli.run(["unlock", "--password-env", "ARDIA_EXAMPLE_PASSWORD"], environment: ["ARDIA_EXAMPLE_PASSWORD": password])
    guard result.succeeded else { return failed(VaultMessages.failure(result, tool: Self.tool, redacting: [password])) }
    cli.remember(session: result.trimmedOutput)
    return signedIn()
  }

  func signOut(_ cli: VaultCLI) async {
    _ = await cli.run(["logout"])
  }

  func items(_ cli: VaultCLI) async throws -> [VaultItem] {
    guard let session = cli.session else { throw VaultError.locked }
    let result = await cli.run(["list", "--json"], environment: ["EXAMPLE_SESSION": session], timeout: 60)
    try check(result)
    return VaultJSON.dicts(VaultJSON.parse(result.stdout)).compactMap { entry in
      guard let itemId = VaultJSON.string(entry["id"]) else { return nil }
      return VaultItem(provider: id, id: itemId, title: VaultJSON.string(entry["title"]) ?? "",
                       username: VaultJSON.string(entry["username"]) ?? "", urls: VaultJSON.strings(entry["urls"]))
    }
  }

  func secret(_ cli: VaultCLI, id: String, field: VaultField) async throws -> String {
    guard let session = cli.session else { throw VaultError.locked }
    let result = await cli.run(["get", field.rawValue, "--id=\(id)"], environment: ["EXAMPLE_SESSION": session])
    try check(result)
    guard !result.trimmedOutput.isEmpty else { throw VaultError.notFound }
    return result.trimmedOutput
  }

  private func check(_ result: VaultCommandResult) throws {
    try checked(result, tool: Self.tool, locked: ["locked"], signedOut: ["not signed in"], missing: ["not found"])
  }
}
```

Then in `VaultRegistry.swift`:

```swift
static let providers: [any VaultProvider] = [OnePasswordVault(), BitwardenVault(), ProtonPassVault(), ExampleVault()]
```

What the core already does for the new manager, so the provider must not repeat it: finding and vetting the
binary, the environment, timeouts and output caps, one call at a time, the state and item caches, `vaults.changed`
and `vaults.itemsChanged`, idle and sleep lock, origin checks before a fill, the clipboard, and dropping the session
when the CLI reports locked or signed out.

## Filling and saving

- **Generated passwords.** `VaultPasswordGenerator` makes four styles (`strong`: four groups of five joined by
  hyphens; `alphanumeric`: 20 letters and digits; `easyToType`: lowercase and digits only, no Shift; `passphrase`:
  five words from the EFF Short Wordlist 1, one capitalized, one digit; four when the field is short). When the field's `maxlength` is shorter, the
  style shrinks or falls back to letters and digits of that length. The password never leaves native code.
- **Submitting.** With `submit: true` the page script waits two frames, checks the origin and form are unchanged and
  nothing required is still empty, then clicks the form's sign-in button, or calls `requestSubmit()`, or presses
  Enter on the last field. At most once per fill.
- **Saving new passwords.** A submission carries `newPassword`, `generated`, `usernameFrom` (`form`, `step`, `page`,
  `nearby` or none) and `trusted` (a real click or Enter, or our Touch ID submit; a page's own `requestSubmit()` is
  not). With Save New Passwords Automatically on (`vaultAutoSave`, default on) a password saves at once to the
  default manager only when it was generated, or is a new password from a trusted submit with a username from the
  form or an earlier step, that username isn't saved for the site yet, one manager is the target, and nothing was
  saved automatically on this page load. The target is Save New Logins To (`vaultSaveTarget`), which lists only
  connected managers (unlocked or locked) that can save; with exactly one connected, that one is the default and
  saves go to it. Ardia's own passwords aren't a target: Chrome's save prompt handles those. Every other new password gets the save popover, prefilled with the best
  guess (the page's username, then the login last used on the site, then the last username filled in the tab) and
  asking for an email or username when there is none; it sends the `username` override. Identical submissions while
  a save runs are ignored.
- **The save popover.** When it asks for an email or username, the field suggests usernames used before
  (`previousUsernames`, emails first; ↑↓ pick, Return or Tab accept, a click too) and starts with the best one. Below it
  is the password, editable in a native field with a show/hide eye: `stageVaultPassword({origin})` on the tab copies
  the captured login into a draft and returns `{token, length}`; the `ArdiaVaultPasswordField` view takes the token,
  shows the draft in an `NSSecureTextField` (an `NSTextField` while shown) and writes each edit back into the tab's
  captured login (and into a kept generated password), so Save sends the edited password through the usual
  `saveToVault`. JS only learns the length, which keeps Save off while the field is empty.
- **Generated passwords that aren't saved.** Every password Ardia generates into a field is kept in
  `<data dir>/Password Managers/Generated.vault` (AES-GCM with the local store's key, 0600, excluded from backups,
  never in iCloud; a hidden instance keeps it in its data dir) until it's confirmed saved in a manager: a
  `saveToVault` or `saveGenerated` that succeeds with that password for that site removes it. Anything else keeps it:
  no submit, a submit that saved nothing, no username, a failed, declined or dismissed save, no manager unlocked that
  can save, an auto-save that didn't happen. Generating again on the same site before submitting replaces the unused
  one; a submit marks it `submitted` and records the username. Keep Generated Passwords (`vaultKeepGenerated`: 1, 7
  (default) or 30 days, Until Deleted, Never) sets how long; expired ones are purged when the setting arrives at launch,
  on every read and hourly, and Never keeps none. The fill menu's Other Passwords… lists them first; filling one asks
  the owner check like any password and fills both the current and new password fields.
- **Auto-submit only after Touch ID.** Native honours `submit` only when that fill used a fresh Touch ID grant.
- **Right-click Autofill.** Right-clicking any text input (`contextmenu`, captured per frame by the page script, which
  keeps that element as the frame's context field and posts `vaultContext`) adds Autofill ▸ to the top of the page's
  context menu: one submenu per matching login (the fill menu's ranking, at most 8, titled with the account and the site, and the manager when two share a title) with Username,
  Password and Verification Code (only when `hasTotp` is true), then Unlock Passwords… while a manager is locked and
  Other Passwords… while one is unlocked. Generate Password ▸ with the four generator styles is added too when
  Generate Passwords in Right-Click Menu (`vaultContextGenerate`, off by default) is on. The page message travels on
  the frame's channel-associated `ACPageHost`, so it reaches the browser before Chrome's `ShowContextMenu`; native
  (`ArdiaWebView+VaultContextMenu.mm`) adds the items in its `+[NSMenu popUpContextMenu:withEvent:forView:]` hook
  (and in `tab:runContextMenu:` for hidden instances, where `context-menu.json` gets them and a pick such as
  `Autofill › <login title> › Password` runs once JS has sent the list). JS (`state/vaults/contextFill.ts`)
  answers `vaultContext` with the list (`setVaultContextMenu`, metadata only), and a choice comes back as
  `vaultContextAction`. A fill is the usual `fillFromVault` with `target: "contextMenu"`: native always treats it as
  `userChose` (the URL match is skipped, never the https rule), never submits, still asks the owner check for a
  password, and marks the page message `context: true`, so the page script writes one value into the right-clicked
  input only (a code spreads over split boxes from the first box) or, for a whole login, fills the form around it.
  Unlock Passwords… unlocks once and Other Passwords… opens the search, both as the fill menu under that field (top
  frame only, since only it has a rect); a pick there fills the classified field's login, or only the guessed value
  into a plain input. Generate fills through `fillGeneratedPassword` with the same target, so the generated password
  is still kept for saving.
- **Remembered logins.** The login last filled or saved per site (registrable domain) is kept as its item key in
  `vault-accounts.json` (at most 500, least recently used dropped) and is ranked first and selected when the menu opens.

## The Ardia row

Settings › Passwords › Password Managers starts with Ardia, Chrome's own password store for the chosen profile. Its
switch is Chrome's offer to save and fill passwords (`setPasswordAutofill`, on unless the person turned it off), and
its ⋯ menu has Import Passwords… (CSV) and, with advanced settings shown, Export Passwords… (Chrome's export, after a
confirm). Every connected manager's ⋯ menu also has Export Passwords… with advanced settings shown (`vaults.export`).

## Saved Passwords

Settings › Passwords lists Ardia's own saved passwords and the logins of every unlocked manager in one list, sorted by
site and searched together; a manager's login carries its badge. Its sheet copies the username, and copies the
password through the broker (owner check first); a manager's password never reaches JS, so it isn't shown.

Above it, Generated Passwords lists the kept generated passwords, newest first, with the site, the username if one was
captured, and when it was generated. Each row has Fill (when the focused window's active tab last focused a login
field on that site), Copy Password (owner check, concealed clipboard), Save to <manager> (a menu when several unlocked
managers can save; without a username a sheet asks for one with the same suggestions), and Delete.
