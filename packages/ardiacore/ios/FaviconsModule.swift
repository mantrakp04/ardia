import ExpoModulesCore

public class FaviconsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFavicons")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      FaviconsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "favicons", handlers: [
    "get": EngineCall.passing("ac_favicons_get"),
    "set": EngineCall.passing("ac_favicons_set"),
    "fetch": { args, reply in ArdiaFavicons.fetch(args.text("url"), profile: args.profile, name: nil) { reply.ok($0) } },
  ])
}
