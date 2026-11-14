import ExpoModulesCore

public class ProfilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    Self.calls.function
  }

  static let calls = CallTable(domain: "profiles", handlers: [
    "loaded": { _, reply in reply.ok(["profiles": ArdiaHost.loadedProfiles]) },
    "release": { args, reply in
      reply.ok(["status": ArdiaHost.releaseProfile(args.profile)])
    },
    "deleteData": { args, reply in PageEngines.deleteProfileData(profile: args.profile) { reply.ok(["remaining": $0]) } },
    "clearBrowsingData": { args, reply in
      PageEngines.clearBrowsingData(profile: args.profile, types: try args.strings("types"), since: try args.optionalDouble("since") ?? 0) { reply.ok() }
    },
  ])
}
