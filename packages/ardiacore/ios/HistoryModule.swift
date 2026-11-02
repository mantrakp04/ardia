import ExpoModulesCore

public class HistoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    Self.calls.function
  }

  static let calls = CallTable(domain: "history", handlers: [
    "query": EngineCall.passing("ac_history_query"),
    "add": EngineCall.passing("ac_history_add"),
    "import": EngineCall.passing("ac_history_import"),
    "deleteUrls": EngineCall.passing("ac_history_delete_urls"),
    "watch": EngineCall.passing("ac_history_watch"),
  ])
}
