import Foundation

struct ProtonPassVault: VaultProvider {
  let id = "protonpass"
  let name = "Proton Pass"
  let binaryName = "pass-cli"
  let capabilities = VaultCapabilities(totp: true, save: true, selfHosted: false, masterPassword: false, touchID: true)
  let install = VaultInstall(command: "brew install protonpass/tap/pass-cli", url: "https://protonpass.github.io/pass-cli/")
  let setup: VaultSetup? = VaultSetup(kind: .browserSignIn)

  private static let tool = "Proton Pass CLI"
  private static let marker = "protonpass-session"
  private static let loginTimeout: TimeInterval = 660
  private static let approvalWait: TimeInterval = 30
  private static let readTimeout: TimeInterval = 90
  private static let signedOutHints = [
    "requires an authenticated client", "session has been invalidated", "log in again", "not logged in", "no session",
  ]
  private static let sessionLockHints = ["session is locked", "sessionlocked"]
  private static let missingHints = [
    "error retrieving item", "no totp fields", "is not a totp field", "invalid item reference", "item not found", "field does not exist",
  ]
  private static let sessionLockMessage = "Proton Pass has a session lock on. Run pass-cli session unlock in Terminal, then try again."

  var environment: [String: String] { ["PROTON_PASS_NO_UPDATE_CHECK": "1", "PROTON_PASS_DISABLE_TELEMETRY": "1"] }

  func isolatedEnvironment(_ directory: String) -> [String: String] {
    ["PROTON_PASS_SESSION_DIR": directory, "PROTON_PASS_KEY_PROVIDER": "fs"]
  }

  func state(_ cli: VaultCLI) async -> VaultProviderState {
    let current = await info(cli)
    if let fields = current.fields {
      let account = VaultJSON.string(fields["email"]) ?? VaultJSON.string(fields["username"])
        ?? VaultJSON.string(fields["personal_access_token_name"])
      return makeState(cli.session == nil ? .locked : .unlocked, account: account)
    }
    if VaultMessages.mentions(current.result, Self.sessionLockHints) { return makeState(.locked, message: Self.sessionLockMessage) }
    if VaultMessages.mentions(current.result, Self.signedOutHints) {
      let message = cli.isSigningIn ? "Finish signing in to Proton in the tab Ardia opened." : cli.value("signInMessage")
      return makeState(.signedOut, message: message)
    }
    return makeState(.unavailable, message: VaultMessages.failure(current.result, tool: Self.tool))
  }

  func signIn(_ cli: VaultCLI, fields: VaultSignInFields) async -> VaultSignInResult {
    if let token = Self.accessToken(fields) {
      let extraPassword = fields.clientSecret == nil ? nil : fields.password
      return await tokenSignIn(cli, token: token, extraPassword: extraPassword)
    }
    let current = await info(cli)
    if current.fields != nil {
      cli.remember(session: Self.marker)
      return signedIn()
    }
    if VaultMessages.mentions(current.result, Self.sessionLockHints) { return failed(Self.sessionLockMessage) }
    return await webSignIn(cli, extraPassword: fields.password)
  }

  func unlock(_ cli: VaultCLI, password: String?) async -> VaultSignInResult {
    let current = await info(cli)
    guard current.fields != nil else {
      if VaultMessages.mentions(current.result, Self.sessionLockHints) { return failed(Self.sessionLockMessage) }
      if VaultMessages.mentions(current.result, Self.signedOutHints) { return failed("Sign in to Proton Pass first.", state: .signedOut) }
      return failed(VaultMessages.failure(current.result, tool: Self.tool), state: .unavailable)
    }
    guard await cli.confirmOwner("unlock Proton Pass") else { return failed("Proton Pass stayed locked.") }
    cli.remember(session: Self.marker)
    return signedIn()
  }

  func signOut(_ cli: VaultCLI) async {
    cli.cancelSigningIn()
    _ = await cli.run(["logout"], timeout: 30)
  }

  func items(_ cli: VaultCLI) async throws -> [VaultItem] {
    guard cli.session != nil else { throw VaultError.locked }
    var items: [VaultItem] = []
    for vault in try await vaults(cli) {
      guard let share = VaultJSON.string(vault["share_id"]), Self.isIdentifier(share) else { continue }
      let arguments = [
        "item", "list", "--share-id=\(share)", "--filter-type=login", "--filter-state=active", "--output=json", "--show-secrets",
      ]
      let result = await cli.run(arguments, timeout: Self.readTimeout)
      try check(result)
      let listed = VaultJSON.dicts(VaultJSON.dict(VaultJSON.parse(result.stdout))?["items"])
      let vaultName = VaultJSON.string(vault["name"])
      items += listed.compactMap { loginItem($0, share: share, vault: vaultName) }
    }
    return items
  }

  func secret(_ cli: VaultCLI, id: String, field: VaultField) async throws -> String {
    guard cli.session != nil else { throw VaultError.locked }
    guard let reference = Self.reference(id) else { throw VaultError.notFound }
    let target = ["--share-id=\(reference.share)", "--item-id=\(reference.item)"]
    if field == .totp {
      let result = await cli.run(["item", "totp"] + target + ["--field=totp", "--output=json"], timeout: 30)
      try check(result)
      guard let code = VaultJSON.string(VaultJSON.dict(VaultJSON.parse(result.stdout))?["totp"]) else { throw VaultError.notFound }
      return code
    }
    let result = await cli.run(["item", "view"] + target + ["--output=json"], timeout: 30)
    try check(result)
    let root = VaultJSON.dict(VaultJSON.parse(result.stdout))
    let item = VaultJSON.dict(root?["item"]) ?? root
    guard let login = Self.login(in: item) else { throw VaultError.notFound }
    let value: String?
    switch field {
    case .username: value = VaultJSON.string(login["username"]) ?? VaultJSON.string(login["email"])
    case .password: value = login["password"] as? String
    case .totp: value = nil
    }
    guard let value, !value.isEmpty else { throw VaultError.notFound }
    return value
  }

  func save(_ cli: VaultCLI, login: VaultNewLogin) async throws -> VaultItem {
    guard cli.session != nil else { throw VaultError.locked }
    guard let vault = try await vaults(cli).first, let share = VaultJSON.string(vault["share_id"]), Self.isIdentifier(share) else {
      throw VaultError.failed("No Proton Pass vault takes new items.")
    }
    let isEmail = login.username.contains("@") && !login.username.contains(where: { $0.isWhitespace })
    var template: [String: Any] = ["title": login.title, "password": login.password, "urls": [login.url], "extra_fields": [Any]()]
    template[isEmail ? "email" : "username"] = login.username
    guard let input = VaultJSON.data(template) else { throw VaultError.failed("Ardia couldn't prepare the login for Proton Pass.") }
    let result = await cli.run(["item", "create", "login", "--share-id=\(share)", "--from-template=-"], input: input, timeout: 60)
    try check(result, redacting: [login.password])
    guard let itemId = result.trimmedOutput.split(whereSeparator: \.isNewline).last.map({ String($0) }), Self.isIdentifier(itemId) else {
      throw VaultError.failed("Proton Pass saved the login but didn't say where.")
    }
    return VaultItem(
      provider: id, id: "\(share)/\(itemId)", title: login.title, username: login.username, urls: [login.url], hasTotp: false,
      vault: VaultJSON.string(vault["name"]), updatedAt: Date().timeIntervalSince1970 * 1000)
  }

  private func info(_ cli: VaultCLI) async -> (fields: [String: Any]?, result: VaultCommandResult) {
    let result = await cli.run(["info", "--output=json"], timeout: 30)
    return (result.succeeded ? VaultJSON.dict(VaultJSON.parse(result.stdout)) : nil, result)
  }

  private func vaults(_ cli: VaultCLI) async throws -> [[String: Any]] {
    let result = await cli.run(["vault", "list", "--output=json"], timeout: Self.readTimeout)
    try check(result)
    return VaultJSON.dicts(VaultJSON.dict(VaultJSON.parse(result.stdout))?["vaults"])
  }

  private func webSignIn(_ cli: VaultCLI, extraPassword: String?) async -> VaultSignInResult {
    let first = VaultFirstValue()
    var extra: [String: String] = [:]
    if let extraPassword { extra["PROTON_PASS_EXTRA_PASSWORD"] = extraPassword }
    cli.setValue("signInMessage", nil)
    cli.start(
      ["login"], environment: extra, timeout: Self.loginTimeout,
      onOutput: { text in
        if let url = Self.approvalURL(in: text) { first.offer(url) }
      },
      completion: { result in
        if result.succeeded {
          cli.remember(session: Self.marker)
        } else if !result.cancelled {
          cli.setValue("signInMessage", Self.loginMessage(result, redacting: extraPassword.map { [$0] } ?? []))
        }
        first.offer(nil)
        cli.announceChange()
      })
    guard let url = await first.wait(timeout: Self.approvalWait) else {
      if cli.session != nil { return signedIn() }
      return failed(cli.value("signInMessage") ?? "Proton Pass didn't start signing in. Try again.", state: .signedOut)
    }
    return needs(.approval, "Finish signing in to Proton in the new tab.", approvalURL: url, state: .signedOut)
  }

  private func tokenSignIn(_ cli: VaultCLI, token: String, extraPassword: String?) async -> VaultSignInResult {
    var environment = ["PROTON_PASS_PERSONAL_ACCESS_TOKEN": token]
    if let extraPassword { environment["PROTON_PASS_EXTRA_PASSWORD"] = extraPassword }
    let result = await cli.run(["login"], environment: environment, timeout: Self.readTimeout)
    guard result.succeeded else {
      if VaultMessages.mentions(result, ["invalid", "unauthorized", "expired"]) {
        return failed("Proton didn't accept that access token.", state: .signedOut)
      }
      return failed(VaultMessages.failure(result, tool: Self.tool, redacting: [token] + (extraPassword.map { [$0] } ?? [])), state: .signedOut)
    }
    cli.remember(session: Self.marker)
    return signedIn()
  }

  private func check(_ result: VaultCommandResult, redacting secrets: [String] = []) throws {
    try checked(result, tool: Self.tool, locked: Self.sessionLockHints, signedOut: Self.signedOutHints, missing: Self.missingHints,
                redacting: secrets)
  }

  private func loginItem(_ entry: [String: Any], share: String, vault: String?) -> VaultItem? {
    guard let itemId = VaultJSON.string(entry["id"]), Self.isIdentifier(itemId), let content = VaultJSON.dict(entry["content"]),
      let login = Self.login(in: entry)
    else { return nil }
    if let state = VaultJSON.string(entry["state"]), state != "Active" { return nil }
    var urls = VaultJSON.strings(login["urls"])
    for autofill in VaultJSON.dicts(login["autofill_urls"]) where VaultJSON.string(autofill["mode"]) != "Never" {
      if let url = VaultJSON.string(autofill["url"]), !urls.contains(url) { urls.append(url) }
    }
    let extraTotp = VaultJSON.dicts(content["extra_fields"]).compactMap { field -> String? in
      guard let kind = VaultJSON.dict(field["content"]) else { return nil }
      return VaultJSON.string(kind["Totp"])
    }.first
    let totp = VaultJSON.string(login["totp_uri"]) ?? extraTotp
    var item = VaultItem(
      provider: id, id: "\(share)/\(itemId)", title: VaultJSON.string(content["title"]) ?? "",
      username: VaultJSON.string(login["username"]) ?? VaultJSON.string(login["email"]) ?? "", urls: urls, hasTotp: totp != nil,
      vault: vault, updatedAt: VaultJSON.milliseconds(entry["modify_time"]))
    item.totpPeriod = totp.flatMap { VaultTotp.period(fromURI: $0) }
    return item
  }

  private static func login(in item: [String: Any]?) -> [String: Any]? {
    guard let content = VaultJSON.dict(item?["content"]), let inner = VaultJSON.dict(content["content"]) else { return nil }
    return VaultJSON.dict(inner["Login"])
  }

  private static func accessToken(_ fields: VaultSignInFields) -> String? {
    guard fields.method == "accessToken" else { return nil }
    return fields.clientSecret ?? fields.password
  }

  private static func reference(_ id: String) -> (share: String, item: String)? {
    guard let slash = id.firstIndex(of: "/") else { return nil }
    let share = String(id[id.startIndex..<slash])
    let item = String(id[id.index(after: slash)...])
    guard isIdentifier(share), isIdentifier(item) else { return nil }
    return (share, item)
  }

  private static func isIdentifier(_ text: String) -> Bool {
    !text.isEmpty && text.count <= 200 && text.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_=+".contains($0)) }
  }

  private static func approvalURL(in text: String) -> String? {
    guard let range = text.range(of: #"https://[^\s"'<>]+"#, options: .regularExpression) else { return nil }
    let candidate = String(text[range])
    guard let host = URLComponents(string: candidate)?.host?.lowercased(), host == "proton.me" || host.hasSuffix(".proton.me") else {
      return nil
    }
    return candidate
  }

  private static func loginMessage(_ result: VaultCommandResult, redacting secrets: [String]) -> String {
    if result.timedOut { return "Signing in to Proton took too long. Try again." }
    if VaultMessages.mentions(result, ["extra password"]) {
      return "Your Proton Pass account has an extra password. Enter it and sign in again."
    }
    return VaultMessages.failure(result, tool: Self.tool, redacting: secrets)
  }
}
