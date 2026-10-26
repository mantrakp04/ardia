import AppKit
import ExpoModulesCore

public class EngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaEngine")
    Events("engine")

    OnCreate {
      EngineCall.listen("engine", self)
      ArdiaEngineBridge.forwardEngineEvents()
      SystemState.shared.onChange = { state in ArdiaEvents.emit("engine.systemState", data: state) }
      SystemState.shared.start()
    }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      EngineModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)

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
    "endTracing": { args, reply in ArdiaHost.endTracing(keep: args.bool("keep") ?? false) { reply.ok($0) } },
    "isTracing": { _, reply in reply.ok(ArdiaHost.isTracing) },
    "systemState": { _, reply in reply.ok(SystemState.shared.snapshot) },
    "batterySaver": EngineCall.passing("ac_battery_saver"),
    "trimMemory": EngineCall.passing("ac_memory_trim"),
    "openTaskManager": EngineCall.passing("ac_task_manager_open"),
    "cliControl": { args, reply in
      guard args.values.keys.contains("activeTab") else { return EngineCall.passing("ac_cli_control")(args, reply) }
      let tabId = args.string("activeTab")
      let active = tabId.map { ArdiaHost.chromeTabId(ofTab: $0) } ?? -1
      EngineCall.passing("ac_cli_control")(CallArgs(profile: args.profile, json: "{\"active\":\(active)}"), reply)
    },
  ])
}
