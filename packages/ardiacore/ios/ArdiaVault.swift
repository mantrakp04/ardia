import Foundation

enum ArdiaVault {
  static let id = "ardia"
  static let name = "Ardia"
  static let capabilities = VaultCapabilities(totp: true, save: true, selfHosted: false, masterPassword: false, touchID: false, addTotp: true)
  static let install = VaultInstall(command: "", url: "")
  static let longestItemId = 8192

  static func state(on: Bool) -> VaultProviderState {
    VaultProviderState(id: id, name: name, state: on ? .unlocked : .unavailable, message: on ? nil : "Off", capabilities: capabilities,
                       install: install)
  }

  static func signInResult(_ state: VaultProviderState) -> VaultSignInResult {
    VaultSignInResult(ok: state.state == .unlocked, state: state)
  }

  static func isWebOrigin(_ origin: String) -> Bool {
    let lowered = origin.lowercased()
    return (lowered.hasPrefix("https://") || lowered.hasPrefix("http://")) && VaultOriginMatch.host(of: origin) != nil
  }

  static func originOfRealm(_ realm: String) -> String {
    var origin = realm
    while origin.hasSuffix("/") { origin.removeLast() }
    return origin
  }

  static func itemId(_ login: ArdiaVaultLogin) -> String {
    Data([login.profile, login.origin, login.username].joined(separator: "\n").utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func login(ofItem id: String) -> ArdiaVaultLogin? {
    guard !id.isEmpty, id.count <= longestItemId else { return nil }
    var base64 = id.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64.append("=") }
    guard let data = Data(base64Encoded: base64), let text = String(data: data, encoding: .utf8) else { return nil }
    let parts = text.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 3, isWebOrigin(parts[1]) else { return nil }
    return ArdiaVaultLogin(profile: parts[0], origin: parts[1], username: parts[2])
  }

  static func item(_ login: ArdiaVaultLogin, hasTotp: Bool) -> VaultItem {
    let host = VaultOriginMatch.host(of: login.origin) ?? login.origin
    let title = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    return VaultItem(provider: id, id: itemId(login), title: title, username: login.username, urls: [login.origin], hasTotp: hasTotp,
                     profile: login.profile)
  }
}
