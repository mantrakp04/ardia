import AuthenticationServices
import Foundation

enum WebKitPasskeys {
  static func access() -> [String: Any] {
    guard WebKitHub.passkeysEntitled else { return ["entitled": false, "status": "entitlementRequired"] }
    return ["entitled": true, "status": status(ASAuthorizationWebBrowserPublicKeyCredentialManager().authorizationStateForPlatformCredentials)]
  }

  static func requestAccess(_ completion: @escaping ([String: Any]) -> Void) {
    guard WebKitHub.passkeysEntitled, deviceConfigured() else { return completion(access()) }
    ASAuthorizationWebBrowserPublicKeyCredentialManager().requestAuthorizationForPublicKeyCredentials { state in
      DispatchQueue.main.async { completion(["entitled": true, "status": Self.status(state)]) }
    }
  }

  private static func deviceConfigured() -> Bool {
    if #available(macOS 26.2, *) { return ASAuthorizationWebBrowserPublicKeyCredentialManager.isDeviceConfiguredForPasskeys }
    return true
  }

  private static func status(_ state: ASAuthorizationWebBrowserPublicKeyCredentialManager.AuthorizationState) -> String {
    guard deviceConfigured() else { return "deviceNotConfigured" }
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
  }
}
