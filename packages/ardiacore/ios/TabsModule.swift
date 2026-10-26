import ExpoModulesCore

public class TabsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaTabs")
    Events("tabs")

    OnCreate {
      EngineCall.listen("tabs", self)
      ArdiaTabStrip.watchStrips()
    }

    Function("prepareTransfer") { (key: String) in
      ArdiaWebView.prepareTransfer(key)
      WebKitHub.shared.prepareTransfer(key)
    }
    Function("releaseTransfer") { (key: String) in
      ArdiaWebView.releaseTransfer(key)
      WebKitHub.shared.releaseTransfer(key)
    }
    Function("claimLaunchTab") { (key: String, url: String, profile: String) in
      ArdiaWebView.claimLaunchTab(key, url: url, profile: profile)
    }
    Function("revealTab") { (key: String) in ArdiaWebView.revealTab(key) }
    Function("dropTabReveals") { (key: String) in ArdiaWebView.dropTabReveals(key) }
    Function("revealOffered") { (adoptId: String, key: String) in ArdiaWebView.revealOffered(adoptId, over: key) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      TabsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "tabs", handlers: [
    "routeLinkTabs": { args, reply in reply.ok(ArdiaWebView.routeLinkTabs(args.strings("urls"))) },
    "stripCommand": { args, reply in
      ArdiaTabStrip.command(args.int("id") ?? 0, command: args.dict("command") ?? [:])
      reply.ok()
    },
    "strips": { _, reply in reply.ok(ArdiaTabStrip.allStrips) },
    "lastTabPolicy": EngineCall.passing("ac_tabs_last_tab_policy"),
    "devBrowserId": { args, reply in reply.ok(ArdiaWebView.browserId(ofTab: args.string("tabId"))) },
    "devEvents": { args, reply in reply.ok(ArdiaWebView.devEvents(browserId: ArdiaWebView.browserId(ofTab: args.string("tabId")))) },
    "devWindowNumber": { args, reply in reply.ok(ArdiaWebView.devWindowNumber(browserId: ArdiaWebView.browserId(ofTab: args.string("tabId")))) },
    "devFocusPage": { args, reply in reply.ok(ArdiaWebView.devFocusPage(browserId: ArdiaWebView.browserId(ofTab: args.string("tabId")))) },
    "devPictureInPicture": { _, reply in reply.ok(ArdiaWebView.devPictureInPicture()) },
    "devPictureInPictureAction": { args, reply in reply.ok(ArdiaWebView.devPictureInPictureAction(args.text("action"))) },
    "devPostPeekMouseUp": { args, reply in reply.ok(ArdiaWebView.devPostPeekMouseUp(args.text("keys"), over: args.text("tabId"))) },
    "devScrollZoom": { args, reply in
      let steps = args.list("steps").compactMap { $0 as? [String: Any] }
      reply.ok(ArdiaWebView.devScrollZoom(steps, browserId: ArdiaWebView.browserId(ofTab: args.string("tabId"))))
    },
  ])
}
