import ExpoModulesCore

public class MediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaMedia")
    Events("media")

    OnCreate { EngineCall.listen("media", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      MediaModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static func chooser(_ action: String) -> CallHandler {
    { args, reply in
      ArdiaHost.deviceChooser(Int32(args.int("id") ?? 0), action: action)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "media", handlers: [
    "displayMediaSources": { _, reply in reply.ok(ArdiaHost.displayMediaSources) },
    "selectDevice": { args, reply in
      ArdiaHost.deviceChooser(Int32(args.int("id") ?? 0), select: Int32(args.int("index") ?? 0))
      reply.ok()
    },
    "cancelDeviceChooser": chooser("cancel"),
    "refreshDeviceChooser": chooser("refresh"),
    "openBluetoothSettings": chooser("settings"),
    "devShowBluetoothChooser": { args, reply in
      reply.ok(ArdiaHost.devShowBluetoothChooser(tabId: args.text("tabId"), unauthorized: args.bool("unauthorized") ?? false))
    },
    "devChooserEvents": { _, reply in reply.ok(ArdiaHost.testChooserEvents()) },
    "showCastDialog": { args, reply in reply.ok(ArdiaHost.showCastDialog(tabId: args.text("tabId"))) },
    "startCasting": { args, reply in
      ArdiaHost.castDialog(Int32(args.int("id") ?? 0), start: args.text("sink"), mode: Int32(args.int("mode") ?? 0))
      reply.ok()
    },
    "stopCasting": { args, reply in
      ArdiaHost.castDialog(Int32(args.int("id") ?? 0), stop: args.text("route"))
      reply.ok()
    },
    "closeCastDialog": { args, reply in
      ArdiaHost.closeCastDialog(Int32(args.int("id") ?? 0))
      reply.ok()
    },
    "watchCastRoutes": { args, reply in
      ArdiaHost.watchCastRoutes(args.profile)
      reply.ok()
    },
    "terminateCastRoute": { args, reply in
      ArdiaHost.terminateCastRoute(args.text("route"))
      reply.ok()
    },
    "changeCaptureSource": { args, reply in
      reply.ok(ArdiaHost.shareTabInstead(capturer: args.text("capturer"), target: args.text("target")))
    },
    "stopCapture": { args, reply in reply.ok(ArdiaHost.stopCapture(tabId: args.text("tabId"))) },
  ])
}
