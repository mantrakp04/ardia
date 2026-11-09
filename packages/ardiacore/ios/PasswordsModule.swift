import AppKit
import ExpoModulesCore

public class PasswordsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Function("applePasswordsAvailable") { () -> Bool in ArdiaWebView.applePasswordsAvailable }
    Function("iCloudPasswordsExtensionSupported") { () -> Bool in ArdiaWebView.iCloudPasswordsExtensionSupported }

    Self.calls.function

    AsyncFunction("save") { (profile: String, origin: String, username: String, password: String, promise: Promise) in
      ArdiaServices.savePassword(profile: profile, origin: origin, username: username, password: password) {
        CallReply(promise: promise).service($0, $1)
      }
    }.runOnQueue(.main)

    AsyncFunction("update") {
      (profile: String, origin: String, username: String, newUsername: String?, newPassword: String?, promise: Promise) in
      ArdiaServices.updatePassword(profile: profile, origin: origin, username: username, newUsername: newUsername,
                                   newPassword: newPassword) { CallReply(promise: promise).service($0, $1) }
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "passwords", handlers: [
    "list": { args, reply in ArdiaServices.listPasswords(profile: args.profile) { reply.service($0, $1) } },
    "unlock": { args, reply in ArdiaServices.unlockPasswords(profile: args.profile) { reply.service($0, $1) } },
    "reveal": { args, reply in
      ArdiaServices.password(profile: args.profile, origin: try args.text("origin"), username: try args.text("username")) { reply.service($0, $1) }
    },
    "remove": { args, reply in
      ArdiaServices.deletePassword(profile: args.profile, origin: try args.text("origin"), username: try args.text("username")) { reply.service($0, $1) }
    },
    "neverSaveOrigins": { args, reply in ArdiaServices.neverSaveOrigins(profile: args.profile) { reply.service($0, $1) } },
    "allowSaving": { args, reply in ArdiaServices.allowSaving(profile: args.profile, origin: try args.text("origin")) { reply.service($0, $1) } },
    "export": { args, reply in ArdiaServices.exportPasswords(profile: args.profile, path: nil) { reply.service($0, $1) } },
    "autofillEnabled": { args, reply in reply.ok(ArdiaServices.profileToggle(.passwordsOffered, profile: args.profile)) },
    "setAutofillEnabled": { args, reply in
      ArdiaServices.setProfileToggle(.passwordsOffered, value: try args.bool("enabled"), profile: args.profile)
      reply.ok()
    },
    "setApplePasswords": { args, reply in
      let profiles = (args.values["extensionProfiles"] as? [Any])?.compactMap { $0 as? String } ?? []
      ArdiaWebView.setApplePasswordsEnabled(try args.bool("enabled"), extensionProfiles: profiles)
      reply.ok()
    },
    "openPasswordsApp": { _, reply in ApplePasswordsApp.open { reply.ok($0) } },
    "setUpVerificationCode": { args, reply in
      ApplePasswordsApp.setUpVerificationCode(try args.text("url")) { reply.ok($0) }
    },
  ])
}

enum ApplePasswordsApp {
  static let bundleIdentifier = "com.apple.Passwords"
  static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.Passwords-Settings.extension")!
  static let maxSetupLength = 2048

  static var appURL: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) }

  static func open(_ done: @escaping (Bool) -> Void) {
    guard let app = appURL else { return done(NSWorkspace.shared.open(settingsURL)) }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.openApplication(at: app, configuration: configuration) { opened, error in
      DispatchQueue.main.async { done(opened != nil && error == nil) }
    }
  }

  static func verificationSetupURL(_ text: String) -> URL? {
    guard text.utf16.count <= maxSetupLength, let parts = URLComponents(string: text),
      let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased()
    else { return nil }
    let items = parts.queryItems ?? []
    func has(_ name: String) -> Bool { items.contains { $0.name.lowercased() == name && !($0.value ?? "").isEmpty } }
    let valid = (scheme == "otpauth" && (host == "totp" || host == "hotp") && has("secret"))
      || (scheme == "otpauth-migration" && host == "offline" && has("data"))
    return valid ? parts.url : nil
  }

  static func setUpVerificationCode(_ text: String, _ done: @escaping (Bool) -> Void) {
    guard let url = verificationSetupURL(text), let app = appURL else { return done(false) }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.open([url], withApplicationAt: app, configuration: configuration) { opened, error in
      DispatchQueue.main.async { done(opened != nil && error == nil) }
    }
  }
}
