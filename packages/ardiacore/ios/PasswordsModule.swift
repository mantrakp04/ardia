import ExpoModulesCore

public class PasswordsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPasswords")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      PasswordsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)

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
      ArdiaServices.password(profile: args.profile, origin: args.text("origin"), username: args.text("username")) { reply.service($0, $1) }
    },
    "remove": { args, reply in
      ArdiaServices.deletePassword(profile: args.profile, origin: args.text("origin"), username: args.text("username")) { reply.service($0, $1) }
    },
    "neverSaveOrigins": { args, reply in ArdiaServices.neverSaveOrigins(profile: args.profile) { reply.service($0, $1) } },
    "allowSaving": { args, reply in ArdiaServices.allowSaving(profile: args.profile, origin: args.text("origin")) { reply.service($0, $1) } },
    "export": { args, reply in ArdiaServices.exportPasswords(profile: args.profile, path: nil) { reply.service($0, $1) } },
    "autofillEnabled": { args, reply in reply.ok(ArdiaServices.boolPreference("credentials_enable_service", profile: args.profile)) },
    "setAutofillEnabled": { args, reply in
      ArdiaServices.setBoolPreference("credentials_enable_service", value: args.bool("enabled") ?? false, profile: args.profile)
      reply.ok()
    },
  ])
}
