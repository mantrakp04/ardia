import Foundation

struct OnePasswordVault: VaultProvider {
  let id = "1password"
  let name = "1Password"
  let binaryName = "op"
  let capabilities = VaultCapabilities(totp: true, save: true, selfHosted: false, masterPassword: false, touchID: true)
  let install = VaultInstall(command: "brew install 1password-cli", url: "https://developer.1password.com/docs/cli/get-started/")
  let setup: VaultSetup? = VaultSetup(kind: .desktopIntegration)

  private static let tool = "1Password CLI"
  private static let marker = "1password-app"
  private static let approvalTimeout: TimeInterval = 90
  private static let readTimeout: TimeInterval = 60
  private static let lockedHints = [
    "not signed in", "not currently signed in", "authorization prompt dismissed", "authorization timeout", "authorization denied",
    "session expired", "signin is required", "sign in again",
  ]
  private static let missingHints = [
    "isn't an item", "could not get item", "could not find item", "no item found", "does not have a field", "more than one item",
    "isn't a valid", "no one-time password",
  ]
  private static let setupMessage =
    "In the 1Password app, open Settings, Developer, and turn on Integrate with 1Password CLI. Then connect again."

  var environment: [String: String] {
    ["OP_INTEGRATION_NAME": "Ardia", "OP_INTEGRATION_ID": "ardia", "OP_INTEGRATION_BUILDNUMBER": Self.buildNumber]
  }

  func isolatedEnvironment(_ directory: String) -> [String: String] { ["OP_CONFIG_DIR": directory] }

  private static var buildNumber: String {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let release = version.split(separator: "-").first.map { String($0) } ?? ""
    let parts = release.split(separator: ".").map { part -> String in
      let digits = String(part).filter { $0.isASCII && $0.isNumber }
      return digits.count < 2 ? String(repeating: "0", count: 2 - digits.count) + digits : digits
    }
    let joined = parts.joined()
    return joined.isEmpty ? "000001" : joined
  }

  func state(_ cli: VaultCLI) async -> VaultProviderState {
    let listed = await accounts(cli)
    if let problem = listed.problem { return makeState(.unavailable, message: problem) }
    guard let account = chosenAccount(cli, in: listed.accounts) else { return makeState(.signedOut, message: Self.setupMessage) }
    let email = VaultJSON.string(account["email"])
    let server = VaultJSON.string(account["url"])
    return makeState(cli.session == nil ? .locked : .unlocked, account: email, server: server)
  }

  func signIn(_ cli: VaultCLI, fields: VaultSignInFields) async -> VaultSignInResult { await connect(cli, requested: fields.account) }

  func unlock(_ cli: VaultCLI, password: String?) async -> VaultSignInResult { await connect(cli, requested: nil) }

  func lock(_ cli: VaultCLI) async {
    _ = await cli.run(["signout"] + accountFlag(cli), timeout: 15)
  }

  func signOut(_ cli: VaultCLI) async {
    await lock(cli)
    cli.setPreference("account", nil)
  }

  func items(_ cli: VaultCLI) async throws -> [VaultItem] {
    guard cli.session != nil else { throw VaultError.locked }
    let result = await cli.run(["item", "list", "--categories", "Login", "--format", "json"] + accountFlag(cli), timeout: Self.readTimeout)
    try check(result)
    return VaultJSON.dicts(VaultJSON.parse(result.stdout)).compactMap { listedItem($0) }
  }

  func secret(_ cli: VaultCLI, id: String, field: VaultField) async throws -> String {
    guard cli.session != nil else { throw VaultError.locked }
    guard Self.isItemId(id) else { throw VaultError.notFound }
    if field == .totp {
      let result = await cli.run(["item", "get", id, "--otp"] + accountFlag(cli), timeout: Self.readTimeout)
      try check(result)
      let code = result.trimmedOutput
      guard !code.isEmpty else { throw VaultError.notFound }
      return code
    }
    let result = await cli.run(["item", "get", id, "--format", "json", "--reveal"] + accountFlag(cli), timeout: Self.readTimeout)
    try check(result)
    let fields = VaultJSON.dicts(VaultJSON.dict(VaultJSON.parse(result.stdout))?["fields"])
    let purpose = field == .username ? "USERNAME" : "PASSWORD"
    guard let match = fields.first(where: { VaultJSON.string($0["purpose"]) == purpose }), let value = match["value"] as? String,
      !value.isEmpty
    else { throw VaultError.notFound }
    return value
  }

  func save(_ cli: VaultCLI, login: VaultNewLogin) async throws -> VaultItem {
    guard cli.session != nil else { throw VaultError.locked }
    let vaultResult = await cli.run(["vault", "list", "--format", "json"] + accountFlag(cli), timeout: Self.readTimeout)
    try check(vaultResult)
    let vaults = VaultJSON.dicts(VaultJSON.parse(vaultResult.stdout))
    let personal = vaults.first { ["private", "personal", "employee"].contains((VaultJSON.string($0["name"]) ?? "").lowercased()) }
    guard let vault = personal ?? vaults.first, let vaultId = VaultJSON.string(vault["id"]), Self.isItemId(vaultId) else {
      throw VaultError.failed("No 1Password vault takes new items.")
    }
    let usernameField: [String: Any] = ["id": "username", "type": "STRING", "purpose": "USERNAME", "label": "username", "value": login.username]
    let passwordField: [String: Any] = ["id": "password", "type": "CONCEALED", "purpose": "PASSWORD", "label": "password", "value": login.password]
    let primaryURL: [String: Any] = ["href": login.url, "primary": true]
    let template: [String: Any] = ["title": login.title, "category": "LOGIN", "fields": [usernameField, passwordField], "urls": [primaryURL]]
    guard let input = VaultJSON.data(template) else { throw VaultError.failed("Ardia couldn't prepare the login for 1Password.") }
    let arguments = ["item", "create", "--category=Login", "--title=\(login.title)", "--url=\(login.url)", "--vault=\(vaultId)", "--format=json"]
    let result = await cli.run(arguments + accountFlag(cli), input: input, timeout: Self.readTimeout)
    try check(result, redacting: [login.password])
    guard let created = VaultJSON.dict(VaultJSON.parse(result.stdout)), var item = listedItem(created) else {
      throw VaultError.failed("1Password saved the login but didn't say where.")
    }
    if item.username.isEmpty { item.username = login.username }
    if item.urls.isEmpty { item.urls = [login.url] }
    return item
  }

  private func accounts(_ cli: VaultCLI) async -> (accounts: [[String: Any]], problem: String?) {
    let result = await cli.run(["account", "list", "--format", "json"], timeout: 20)
    if result.succeeded { return (VaultJSON.dicts(VaultJSON.parse(result.stdout)), nil) }
    if VaultMessages.mentions(result, ["no accounts", "no account found"]) { return ([], nil) }
    return ([], VaultMessages.failure(result, tool: Self.tool))
  }

  private func chosenAccount(_ cli: VaultCLI, in accounts: [[String: Any]]) -> [String: Any]? {
    if let chosen = cli.preference("account") {
      let keys = ["account_uuid", "shorthand", "url", "email", "user_uuid"]
      if let match = accounts.first(where: { account in keys.contains { VaultJSON.string(account[$0]) == chosen } }) { return match }
    }
    return accounts.first
  }

  private func accountFlag(_ cli: VaultCLI) -> [String] {
    guard let account = cli.preference("account") else { return [] }
    return ["--account=\(account)"]
  }

  private func connect(_ cli: VaultCLI, requested: String?) async -> VaultSignInResult {
    let listed = await accounts(cli)
    if let problem = listed.problem { return failed(problem, state: .unavailable) }
    if let requested { cli.setPreference("account", requested) }
    guard let account = chosenAccount(cli, in: listed.accounts),
      let reference = VaultJSON.string(account["account_uuid"]) ?? VaultJSON.string(account["shorthand"]) ?? VaultJSON.string(account["url"])
    else { return failed(Self.setupMessage, state: .signedOut) }
    cli.setPreference("account", reference)
    let result = await cli.run(["vault", "list", "--format", "json"] + accountFlag(cli), timeout: Self.approvalTimeout)
    guard result.succeeded else { return failed(connectMessage(result)) }
    cli.remember(session: Self.marker)
    return signedIn()
  }

  private func connectMessage(_ result: VaultCommandResult) -> String {
    if result.timedOut { return "1Password didn't confirm in time. Approve Ardia in 1Password and try again." }
    if VaultMessages.mentions(result, ["dismissed", "denied", "cancel"]) { return "1Password stayed locked." }
    if VaultMessages.mentions(result, ["cannot connect", "connect to the 1password app", "desktop app"]) {
      return "Ardia couldn't reach the 1Password app. " + Self.setupMessage
    }
    return VaultMessages.failure(result, tool: Self.tool)
  }

  private func check(_ result: VaultCommandResult, redacting secrets: [String] = []) throws {
    try checked(result, tool: Self.tool, locked: Self.lockedHints, signedOut: ["no accounts configured"], missing: Self.missingHints,
                redacting: secrets)
  }

  private func listedItem(_ entry: [String: Any]) -> VaultItem? {
    guard let itemId = VaultJSON.string(entry["id"]) else { return nil }
    let urls = VaultJSON.dicts(entry["urls"]).compactMap { VaultJSON.string($0["href"]) }
    let vault = VaultJSON.dict(entry["vault"]).flatMap { VaultJSON.string($0["name"]) }
    return VaultItem(
      provider: id, id: itemId, title: VaultJSON.string(entry["title"]) ?? "", username: VaultJSON.string(entry["additional_information"]) ?? "",
      urls: urls, hasTotp: nil, vault: vault, favorite: VaultJSON.bool(entry["favorite"]), updatedAt: VaultJSON.milliseconds(entry["updated_at"]))
  }

  private static func isItemId(_ id: String) -> Bool {
    !id.isEmpty && id.count <= 64 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
  }
}
