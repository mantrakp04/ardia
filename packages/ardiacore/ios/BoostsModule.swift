import ExpoModulesCore

public class BoostsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaBoosts")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      BoostsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static func accepted(_ reply: CallReply) -> (Bool) -> Void {
    { accepted in
      if accepted { return reply.ok() }
      reply.fail("ERR_BOOSTS", "the engine refused the boosts")
    }
  }

  static let calls = CallTable(domain: "boosts", handlers: [
    "setProfileBoosts": { args, reply in
      ArdiaHost.setProfileBoosts(profile: args.profile, json: try args.text("json"), completion: accepted(reply))
    },
    "previewBoost": { args, reply in accepted(reply)(ArdiaHost.previewBoost(tabId: try args.text("tabId"), json: try args.text("json"))) },
    "clearBoostPreview": { args, reply in accepted(reply)(ArdiaHost.clearBoostPreview(tabId: try args.text("tabId"))) },
  ])
}
