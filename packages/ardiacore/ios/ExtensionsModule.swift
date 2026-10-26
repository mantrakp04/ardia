import AppKit
import ExpoModulesCore

public class ExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaExtensions")
    Events("extensions")

    OnCreate {
      EngineCall.listen("extensions", self)
      ArdiaHost.replayInstallPrompts()
    }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      ExtensionsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static func chooseFolder(_ args: CallArgs, _ reply: CallReply) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.prompt = "Select"
    panel.message = "Choose an extension folder (with a manifest.json)"
    panel.begin { response in reply.ok(response == .OK ? panel.url?.path : nil) }
  }

  static func inspectUnpacked(_ args: CallArgs, _ reply: CallReply) {
    let info = ArdiaServices.inspectUnpacked(args.text("path"))
    if let error = info["error"] { return reply.fail("ERR_ENGINE", error as? String ?? "\(error)") }
    reply.ok(info)
  }

  static let calls = CallTable(domain: "extensions", handlers: [
    "list": { args, reply in ArdiaServices.listExtensions(profile: args.profile) { reply.service($0, $1) } },
    "inspectUnpacked": inspectUnpacked,
    "install": { args, reply in ArdiaServices.installExtension(path: args.text("path"), profile: args.profile) { reply.service($0, $1) } },
    "installCrx": { args, reply in ArdiaServices.installCrx(path: args.text("path"), profile: args.profile) { reply.service($0, $1) } },
    "setEnabled": { args, reply in
      ArdiaServices.setExtension(args.text("id"), enabled: args.bool("enabled") ?? false, profile: args.profile) { reply.service($0, $1) }
    },
    "uninstall": { args, reply in ArdiaServices.uninstallExtension(args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "reload": { args, reply in ArdiaServices.reloadExtension(args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "configure": { args, reply in
      ArdiaServices.configureExtension(args.text("id"), profile: args.profile, options: args.dict("options") ?? [:]) { reply.service($0, $1) }
    },
    "chooseFolder": chooseFolder,
    "resolveInstallPrompt": { args, reply in
      ArdiaHost.resolveExtensionInstallPrompt(args.text("requestId"), accepted: args.bool("accepted") ?? false)
      reply.ok()
    },
    "actionStates": { args, reply in
      reply.ok(ArdiaHost.actionStates(tabId: args.text("tabId"), extensions: args.strings("ids")))
    },
    "sidePanelUrl": { args, reply in
      reply.ok(ArdiaHost.sidePanelURL(tabId: args.text("tabId"), extension: args.text("extensionId")))
    },
    "watchActions": EngineCall.passing("ac_extensions_watch_actions"),
    "syncState": EngineCall.passing("ac_extensions_sync_state"),
    "syncApply": EngineCall.passing("ac_extensions_sync_apply"),
  ])
}
