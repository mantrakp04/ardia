import AppKit
import ExpoModulesCore

public class ExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    OnCreate {
      ArdiaHost.replayInstallPrompts()
    }

    Self.calls.function
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

  static func inspectUnpacked(_ args: CallArgs, _ reply: CallReply) throws {
    let info = ArdiaServices.inspectUnpacked(try args.text("path"))
    if let error = info["error"] { return reply.fail("ERR_ENGINE", error as? String ?? "\(error)") }
    reply.ok(info)
  }

  static let calls = CallTable(domain: "extensions", handlers: [
    "list": { args, reply in ArdiaServices.listExtensions(profile: args.profile) { reply.service($0, $1) } },
    "inspectUnpacked": inspectUnpacked,
    "install": { args, reply in ArdiaServices.installExtension(path: try args.text("path"), profile: args.profile) { reply.service($0, $1) } },
    "installCrx": { args, reply in ArdiaServices.installCrx(path: try args.text("path"), profile: args.profile) { reply.service($0, $1) } },
    "setEnabled": { args, reply in
      ArdiaServices.setExtension(try args.text("id"), enabled: try args.bool("enabled"), profile: args.profile) { reply.service($0, $1) }
    },
    "uninstall": { args, reply in ArdiaServices.uninstallExtension(try args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "reload": { args, reply in ArdiaServices.reloadExtension(try args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "configure": { args, reply in
      ArdiaServices.configureExtension(try args.text("id"), profile: args.profile, options: try args.dict("options")) { reply.service($0, $1) }
    },
    "chooseFolder": chooseFolder,
    "resolveInstallPrompt": { args, reply in
      ArdiaHost.resolveExtensionInstallPrompt(try args.text("requestId"), accepted: try args.bool("accepted"))
      reply.ok()
    },
    "actionStates": { args, reply in
      reply.ok(ArdiaHost.actionStates(tabId: try args.text("tabId"), extensions: try args.strings("ids")))
    },
    "sidePanelUrl": { args, reply in
      reply.ok(ArdiaHost.sidePanelURL(tabId: try args.text("tabId"), extension: try args.text("extensionId")))
    },
    "watchActions": EngineCall.passing("ac_extensions_watch_actions"),
    "syncState": EngineCall.passing("ac_extensions_sync_state"),
    "syncApply": EngineCall.passing("ac_extensions_sync_apply"),
  ])
}
