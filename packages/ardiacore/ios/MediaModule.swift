import ExpoModulesCore

public class MediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    Self.calls.function
  }

  static func chooser(_ action: String) -> CallHandler {
    { args, reply in
      ArdiaHost.deviceChooser(try args.int32("id"), action: action)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "media", handlers: [
    "displayMediaSources": { _, reply in reply.ok(ArdiaHost.displayMediaSources) },
    "selectDevice": { args, reply in
      ArdiaHost.deviceChooser(try args.int32("id"), select: try args.int32("index"))
      reply.ok()
    },
    "cancelDeviceChooser": chooser("cancel"),
    "refreshDeviceChooser": chooser("refresh"),
    "openBluetoothSettings": chooser("settings"),
    "devShowBluetoothChooser": { args, reply in
      reply.ok(ArdiaHost.devShowBluetoothChooser(tabId: try args.text("tabId"), unauthorized: try args.bool("unauthorized")))
    },
    "devChooserEvents": { _, reply in reply.ok(ArdiaHost.testChooserEvents()) },
    "showCastDialog": { args, reply in reply.ok(ArdiaHost.showCastDialog(tabId: try args.text("tabId"))) },
    "startCasting": { args, reply in
      ArdiaHost.castDialog(try args.int32("id"), start: try args.text("sink"), mode: try args.int32("mode"))
      reply.ok()
    },
    "stopCasting": { args, reply in
      ArdiaHost.castDialog(try args.int32("id"), stop: try args.text("route"))
      reply.ok()
    },
    "closeCastDialog": { args, reply in
      ArdiaHost.closeCastDialog(try args.int32("id"))
      reply.ok()
    },
    "watchCastRoutes": { args, reply in
      ArdiaHost.watchCastRoutes(args.profile)
      reply.ok()
    },
    "terminateCastRoute": { args, reply in
      ArdiaHost.terminateCastRoute(try args.text("route"))
      reply.ok()
    },
    "changeCaptureSource": { args, reply in
      reply.ok(ArdiaHost.shareTabInstead(capturer: try args.text("capturer"), target: try args.text("target")))
    },
    "stopCapture": { args, reply in reply.ok(ArdiaHost.stopCapture(tabId: try args.text("tabId"))) },
  ])
}
