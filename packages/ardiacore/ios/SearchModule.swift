import ExpoModulesCore

public class SearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSearch")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      SearchModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "search", handlers: [
    "engines": { args, reply in ArdiaServices.searchEngineList(profile: args.profile) { reply.service($0, $1) } },
    "setEngineName": { args, reply in
      ArdiaWebView.setSearchEngineName(args.text("name"))
      reply.ok()
    },
  ])
}
