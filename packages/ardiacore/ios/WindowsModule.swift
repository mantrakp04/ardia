import AppKit
import ExpoModulesCore

public class WindowsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWindows")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      WindowsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "windows", handlers: [
    "list": { _, reply in reply.ok(ArdiaHost.chromeWindows) },
    "dev": { args, reply in
      guard let window = NSApp.window(withWindowNumber: args.int("window") ?? 0) else { return reply.ok("") }
      reply.ok(ArdiaChromeWindowHost.devAction(args.text("action"), window: window) ?? "")
    },
  ])
}
