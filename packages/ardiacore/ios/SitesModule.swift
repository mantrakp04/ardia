import ExpoModulesCore

public class SitesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSites")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      SitesModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "sites", handlers: [
    "settings": { args, reply in
      PageEngines.named(args.string("engine")).siteSettings(profile: args.profile, origin: args.text("origin")) { reply.service($0, $1) }
    },
    "setSetting": { args, reply in
      PageEngines.named(args.string("engine")).setSiteSetting(
        profile: args.profile, origin: args.text("origin"), type: args.text("type"), value: args.text("value"))
      reply.ok()
    },
    "origins": { args, reply in ArdiaServices.siteSettingsOrigins(profile: args.profile) { reply.service($0, $1) } },
    "reset": { args, reply in
      ArdiaServices.resetSiteSettings(profile: args.profile, origin: args.text("origin"))
      reply.ok()
    },
    "clearData": { args, reply in ArdiaServices.clearSiteData(profile: args.profile, origin: args.text("origin")) { reply.service($0, $1) } },
    "zoomLevels": { args, reply in ArdiaServices.zoomLevels(profile: args.profile) { reply.service($0, $1) } },
    "setZoom": { args, reply in
      ArdiaServices.setZoom(args.double("zoom") ?? 1, profile: args.profile, host: args.text("host"))
      reply.ok()
    },
  ])
}
