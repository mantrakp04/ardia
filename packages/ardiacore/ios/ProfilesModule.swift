import ExpoModulesCore

public class ProfilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function
  }

  static let calls = CallTable(domain: "profiles", handlers: [
    "release": { args, reply in
      ArdiaHost.releaseProfile(args.profile)
      reply.ok()
    },
    "deleteData": { args, reply in PageEngines.deleteProfileData(profile: args.profile) { reply.ok(["remaining": $0]) } },
    "clearBrowsingData": { args, reply in
      PageEngines.clearBrowsingData(profile: args.profile, types: try args.strings("types"), since: try args.optionalDouble("since") ?? 0) { reply.ok() }
    },
  ])
}
