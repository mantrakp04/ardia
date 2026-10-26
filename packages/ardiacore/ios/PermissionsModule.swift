import ExpoModulesCore

public class PermissionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPermissions")
    Events("permissions")

    OnCreate { EngineCall.listen("permissions", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      PermissionsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "permissions", handlers: [
    "resolve": { args, reply in
      let id = args.text("id")
      PageEngines.owner(of: id).resolvePermission(id, result: args.text("result"), remember: args.bool("remember") ?? false)
      reply.ok()
    },
    "resolveExternalApp": { args, reply in
      let id = args.text("id")
      PageEngines.owner(of: id).resolveExternalApp(id, open: args.bool("open") ?? false, remember: args.bool("remember") ?? false)
      reply.ok()
    },
    "externalAppAllowances": { args, reply in PageEngines.externalAppAllowances(profile: args.profile) { reply.ok($0) } },
    "removeExternalAppAllowance": { args, reply in
      PageEngines.removeExternalAppAllowance(profile: args.profile, origin: args.text("origin"), scheme: args.text("scheme"))
      reply.ok()
    },
    "devExternalLaunches": { _, reply in reply.ok(ArdiaHost.testExternalLaunches()) },
  ])
}
