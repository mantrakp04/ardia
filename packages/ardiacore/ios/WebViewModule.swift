import AppKit
import ExpoModulesCore

public class WebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function

    PageViewDefinition.of(ChromiumTabView.self)
  }

  static func setting(_ apply: @escaping (CallArgs) throws -> Void) -> CallHandler {
    { args, reply in
      try apply(args)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "webView", handlers: [
    "setDisplayMediaPicker": setting { ArdiaWebView.setDisplayMediaPicker(try $0.bool("enabled")) },
    "setPeekModifier": setting { ArdiaWebView.setPeekModifier(try $0.text("modifier")) },
    "setSplitLinkModifier": setting { ArdiaWebView.setSplitLinkModifier(try $0.text("modifier")) },
    "setPeekOtherSiteTabs": setting { ArdiaWebView.setPeekOtherSiteTabs(try $0.strings("tabIds")) },
    "setSelectionPopover": setting { ArdiaWebView.setSelectionPopoverEnabled(try $0.bool("enabled")) },
    "setCommandScrollZoom": setting { ArdiaWebView.setCommandScrollZoomEnabled(try $0.bool("enabled")) },
    "setAutoPictureInPicture": setting { ArdiaWebView.setAutoPictureInPictureEnabled(try $0.bool("enabled")) },
    "setVideoUpscaling": setting { ArdiaWebView.setVideoUpscalingEnabled(try $0.bool("enabled")) },
    "setVideoUpscalingTestConditions": setting { args in
      var conditions: [String: NSNumber] = [:]
      for key in ["lowPower", "thermalPressure"] { if let on = try args.optionalBool(key) { conditions[key] = NSNumber(value: on) } }
      ArdiaWebView.setVideoUpscalingTestConditions(conditions)
    },
    "videoUpscalingState": { _, reply in reply.ok(ArdiaWebView.videoUpscalingState()) },
  ])
}

