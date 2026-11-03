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
    "expireBefore": { args, reply in
      EngineCall.passing("ac_history_expire_before", profile: args.profile, args: ["before": try args.double("before")], reply: reply)
    },
    "watch": EngineCall.passing("ac_history_watch"),
  ])
}
