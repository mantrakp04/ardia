import ExpoModulesCore

public class ContentBlockerModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    Self.calls.function
  }

  static func settled(_ reply: CallReply) -> (String?) -> Void {
    { error in
      if let error { return reply.fail("ERR_CONTENT_BLOCKER", error) }
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "contentBlocker", handlers: [
    "state": { _, reply in ArdiaContentBlocker.state { reply.ok($0) } },
    "setEnabled": { args, reply in ArdiaContentBlocker.setEnabled(try args.bool("enabled"), completion: settled(reply)) },
    "setListEnabled": { args, reply in
      ArdiaContentBlocker.setList(try args.text("id"), enabled: try args.bool("enabled"), completion: settled(reply))
    },
    "isAllowed": { args, reply in ArdiaContentBlocker.isAllowed(host: try args.text("host")) { reply.ok($0) } },
    "setAllowed": { args, reply in
      ArdiaContentBlocker.setAllowed(try args.bool("allowed"), host: try args.text("host"), completion: settled(reply))
    },
    "devFailNextMessage": { _, reply in
      ArdiaContentBlocker.devFailNextMessage()
      reply.ok()
    },
    "devDelayNextLoad": { args, reply in
      ArdiaContentBlocker.devDelayNextLoad(try args.double("ms"))
      reply.ok()
    },
  ])
}
