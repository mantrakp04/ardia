import ExpoModulesCore

public class DownloadsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    OnCreate {
      ArdiaServices.watchDownloadEvents()
    }

    Self.calls.function
  }

  static func command(_ action: String) -> CallHandler {
    { args, reply in
      let id = try args.text("id")
      PageEngines.owner(of: id).downloadCommand(action, id: id)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "downloads", handlers: [
    "cancel": command("cancel"),
    "pause": command("pause"),
    "resume": command("resume"),
    "keep": command("keep"),
    "settings": EngineCall.passing("ac_downloads_settings"),
    "setSettings": EngineCall.passing("ac_downloads_set_settings"),
  ])
}
