import Foundation

protocol VaultProvider: Sendable {
  var id: String { get }
  var name: String { get }
  var binaryName: String { get }
  var capabilities: VaultCapabilities { get }
  var install: VaultInstall { get }
  var setup: VaultSetup? { get }
  var environment: [String: String] { get }

  func isolatedEnvironment(_ directory: String) -> [String: String]
  func state(_ cli: VaultCLI) async -> VaultProviderState
  func signIn(_ cli: VaultCLI, fields: VaultSignInFields) async -> VaultSignInResult
  func unlock(_ cli: VaultCLI, password: String?) async -> VaultSignInResult
  func lock(_ cli: VaultCLI) async
  func signOut(_ cli: VaultCLI) async
  func configure(_ cli: VaultCLI, server: String?) async -> String?
  func items(_ cli: VaultCLI) async throws -> [VaultItem]
  func itemsAndPasswords(_ cli: VaultCLI) async throws -> VaultItemList
  func secret(_ cli: VaultCLI, id: String, field: VaultField) async throws -> String
  func save(_ cli: VaultCLI, login: VaultNewLogin) async throws -> VaultItem
}

struct VaultItemList: Sendable {
  var items: [VaultItem]
  var passwords: [String: String] = [:]
}

extension VaultProvider {
  func itemsAndPasswords(_ cli: VaultCLI) async throws -> VaultItemList { VaultItemList(items: try await items(cli)) }
  var setup: VaultSetup? { nil }
  var environment: [String: String] { [:] }

  func isolatedEnvironment(_ directory: String) -> [String: String] { [:] }
  func lock(_ cli: VaultCLI) async {}
  func configure(_ cli: VaultCLI, server: String?) async -> String? { "\(name) has no server setting." }
  func save(_ cli: VaultCLI, login: VaultNewLogin) async throws -> VaultItem { throw VaultError.unsupported }

  func makeState(_ state: VaultState, account: String? = nil, server: String? = nil, message: String? = nil) -> VaultProviderState {
    VaultProviderState(id: id, name: name, state: state, account: account, server: server, message: message, capabilities: capabilities,
                       install: install, setup: setup)
  }

  func signedIn() -> VaultSignInResult { VaultSignInResult(ok: true, state: makeState(.unlocked)) }

  func needs(_ need: VaultSignInNeed, _ message: String? = nil, methods: [VaultMethod]? = nil, approvalURL: String? = nil,
             state: VaultState = .locked) -> VaultSignInResult {
    VaultSignInResult(ok: false, state: makeState(state), needs: need, methods: methods, error: message, approvalURL: approvalURL)
  }

  func failed(_ message: String, state: VaultState = .locked) -> VaultSignInResult {
    VaultSignInResult(ok: false, state: makeState(state), error: message)
  }

  func checked(_ result: VaultCommandResult, tool: String, locked: [String], signedOut: [String], missing: [String],
               redacting secrets: [String] = []) throws {
    guard !result.succeeded else { return }
    if VaultMessages.mentions(result, locked) { throw VaultError.locked }
    if VaultMessages.mentions(result, signedOut) { throw VaultError.signedOut }
    if VaultMessages.mentions(result, missing) { throw VaultError.notFound }
    throw VaultError.failed(VaultMessages.failure(result, tool: tool, redacting: secrets))
  }
}
