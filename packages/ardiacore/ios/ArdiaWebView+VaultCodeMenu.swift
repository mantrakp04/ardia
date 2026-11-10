import AppKit

extension ArdiaWebView {
  func setVaultCodeMenu(token: String, menu: [String: Any]) {
    applyVaultCodeMenu(menu, token: token)
  }
}
