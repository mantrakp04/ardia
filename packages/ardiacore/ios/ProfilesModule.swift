import ExpoModulesCore

public class ProfilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaProfiles")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      ProfilesModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "profiles", handlers: [
    "release": { args, reply in
      ArdiaHost.releaseProfile(args.profile)
      reply.ok()
    },
    "deleteData": { args, reply in PageEngines.deleteProfileData(profile: args.profile) { reply.ok(["remaining": $0]) } },
    "clearBrowsingData": { args, reply in
      PageEngines.clearBrowsingData(profile: args.profile, types: args.strings("types"), since: args.double("since") ?? 0) { reply.ok() }
    },
  ])
}
