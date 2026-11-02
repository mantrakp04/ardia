import AppKit
import ExpoModulesCore

public class EngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    OnCreate {
      ArdiaEngineBridge.forwardEngineEvents()
      SystemState.shared.onChange = { state in ArdiaEvents.emit("engine.systemState", data: state) }
      SystemState.shared.start()
    }

    Self.calls.function

    Function("inputIdleSeconds") { () -> Double in
      guard NSRunningApplication.current.isActive else { return 3600 }
      return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: UInt32.max)!)
    }
  }

  static let calls = CallTable(domain: "engine", handlers: [
    "info": { _, reply in reply.ok(ArdiaHost.engineInfo) },
    "components": { _, reply in ArdiaServices.components { reply.service($0, $1) } },
    "tasks": { _, reply in ArdiaServices.tasks { reply.service($0, $1) } },
    "beginTracing": { _, reply in ArdiaHost.beginTracing { reply.ok($0) } },
    "endTracing": { args, reply in ArdiaHost.endTracing(keep: try args.bool("keep")) { reply.ok($0) } },
    "isTracing": { _, reply in reply.ok(ArdiaHost.isTracing) },
    "systemState": { _, reply in reply.ok(SystemState.shared.snapshot) },
    "batterySaver": EngineCall.passing("ac_battery_saver"),
    "memorySaver": EngineCall.passing("ac_memory_saver"),
    "validateKeepActiveSite": { args, reply in
      EngineCall.passing("ac_memory_saver", profile: args.profile, args: ["validate": try args.text("site")], reply: reply)
    },
    "trimMemory": EngineCall.passing("ac_memory_trim"),
    "openTaskManager": EngineCall.passing("ac_task_manager_open"),
    "cliControlStatus": EngineCall.passing("ac_cli_control"),
    "setCliControl": { args, reply in
      EngineCall.passing("ac_cli_control", profile: args.profile, args: ["on": try args.bool("on")], reply: reply)
    },
    "setCliActiveTab": { args, reply in
      let active = try args.optionalText("tabId").map { ArdiaHost.chromeTabId(ofTab: $0) } ?? -1
      EngineCall.passing("ac_cli_control", profile: args.profile, args: ["active": active], reply: reply)
    },
  ])
}
