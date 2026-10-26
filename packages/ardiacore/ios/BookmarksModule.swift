import ExpoModulesCore

public class BookmarksModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaBookmarks")
    Events("bookmarks")

    OnCreate { EngineCall.listen("bookmarks", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      BookmarksModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "bookmarks", handlers: [
    "tree": EngineCall.passing("ac_bookmarks_tree"),
    "apply": EngineCall.passing("ac_bookmarks_apply"),
    "watch": EngineCall.passing("ac_bookmarks_watch"),
  ])
}
