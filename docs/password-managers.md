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
| `VaultBroker.swift` | The one actor every caller goes through. Caches provider states and item lists (60 s), serialises every CLI call per provider through a `VaultLane`, emits `vaults.changed` and `vaults.itemsChanged`, and runs the fill and save checks. |
| `VaultProvider.swift` | The protocol a manager implements, plus shared helpers (`makeState`, `signedIn`, `needs`, `failed`, `checked`). |
| `VaultRegistry.swift` | The list of managers. |
| `VaultCLI.swift` | One resolved binary plus its environment and the provider's slice of the session store. Providers only ever run commands through it. |
| `VaultCommand.swift`, `VaultCommandResult.swift` | The hardened process runner. |
| `VaultBinaryLocator.swift` | Where binaries may live, and the ownership and permission check. |
| `VaultSessionStore.swift`, `VaultKeychain.swift`, `VaultOwnerCheck.swift` | Sessions in memory, the optional Touch ID copy, the idle clock, scratch values and preferences per provider, and the running long command (Proton's browser sign-in). |
| `VaultAutoLock.swift` | Locks every manager on sleep, screen lock and fast user switch, and checks the idle timeout every minute. |
| `VaultOriginMatch.swift` | Pure origin matching (no state, Foundation only). |
| `VaultClipboard.swift`, `VaultPasswordGenerator.swift`, `VaultTotp.swift` | Concealed clipboard copy, strong passwords, one-time code timing. |
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
   screen lock or fast user switch, every manager locks and `vaults.changed` is emitted. Sleep, screen lock and fast
   user switch also wipe every tab's captured logins (`ArdiaVaultCapture wipeAll`).
9. **Clipboard.** Copies are marked `org.nspasteboard.ConcealedType` and `org.nspasteboard.TransientType`, and the
   pasteboard is cleared after 90 s if nothing else was copied since.
10. **Test instances.** With `ARDIA_DATA_DIR` set, binaries are looked up only in `<data dir>/Password Managers/bin`,
    each CLI gets its own state folder under `<data dir>/Password Managers/<id>` (`OP_CONFIG_DIR`,
    `BITWARDENCLI_APPDATA_DIR`, `PROTON_PASS_SESSION_DIR` with the file key provider), and the keychain copy goes to
    `<data dir>/Password Managers.json` (0600) instead of the real keychain. In background mode the owner check never
    prompts (it answers from `ARDIA_TEST=reauth=granted`), copies go to a private pasteboard, and sleep or screen lock
    of the owner's Mac doesn't lock the test's vaults.

### Known limits

- Bitwarden items with master password re-prompt are left out of the list, because the CLI can't honour re-prompt.
- Bitwarden's new-device email code has no CLI flag; the sign-in error suggests the personal API key instead.
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
| `copy` | `{provider, id, field: "username" \| "password" \| "totp"}` | `{copied, clearsAfter}` |
| `totp` | `{provider, id}` | `{code, period, expiresAt} \| null` |
| `generate` | `{}` | `{length}` |
| `setOptions` | `{idleLockMinutes, touchID}` | `{}` |

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

Events: `vaults.changed` `{provider: VaultProviderState}` and `vaults.itemsChanged` `{provider}`.

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
