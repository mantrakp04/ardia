import ExpoModulesCore

public class HistoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaHistory")
    Events("history")

    OnCreate { EngineCall.listen("history", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      HistoryModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "history", handlers: [
    "query": EngineCall.passing("ac_history_query"),
    "add": EngineCall.passing("ac_history_add"),
    "import": EngineCall.passing("ac_history_import"),
    "deleteUrls": EngineCall.passing("ac_history_delete_urls"),
    "watch": EngineCall.passing("ac_history_watch"),
  ])
}
