import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers

public class BookmarksModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaBookmarks")
    Events("bookmarks")

    OnCreate { EngineCall.listen("bookmarks", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      BookmarksModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static func exportHtml(_ args: CallArgs, _ reply: CallReply) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "Ardia Bookmarks.html"
    panel.allowedContentTypes = [.html]
    panel.canCreateDirectories = true
    panel.begin { response in
      guard response == .OK, let path = panel.url?.path else { return reply.ok(nil) }
      guard let data = try? JSONSerialization.data(withJSONObject: ["path": path]), let json = String(data: data, encoding: .utf8) else {
        return reply.fail("ERR_BAD_REPLY", "the path isn't JSON")
      }
      ArdiaEngineBridge.call("ac_bookmarks_export_html", profile: args.profile, args: json) { result in
        if let message = CallReply.engineError(result) { return reply.fail("ERR_ENGINE", message) }
        reply.ok(path)
      }
    }
  }

  static let calls = CallTable(domain: "bookmarks", handlers: [
    "tree": EngineCall.passing("ac_bookmarks_tree"),
    "apply": EngineCall.passing("ac_bookmarks_apply"),
    "watch": EngineCall.passing("ac_bookmarks_watch"),
    "exportHtml": exportHtml,
  ])
}
