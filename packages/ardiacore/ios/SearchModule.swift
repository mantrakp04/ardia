import ExpoModulesCore

public class SearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function
  }

  static let calls = CallTable(domain: "search", handlers: [
    "engines": { args, reply in ArdiaServices.searchEngineList(profile: args.profile) { reply.service($0, $1) } },
    "setEngineName": { args, reply in
      ArdiaWebView.setSearchEngineName(try args.text("name"))
      reply.ok()
    },
  ])
}
