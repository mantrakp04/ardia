import ExpoModulesCore

public class TelemetryLocalModule: Module {
  private static func reply(_ exported: TelemetryLocalStore.Exported?) -> [String: Any]? {
    exported.map { ["path": $0.path, "bytes": $0.bytes, "lines": $0.lines] }
  }

  public func definition() -> ModuleDefinition {
    Name("ArdiaTelemetryLocal")

    Function("append") { (day: String, text: String) in TelemetryLocalStore.append(day: day, text: text) }
    Function("appendNow") { (day: String, text: String) in TelemetryLocalStore.appendNow(day: day, text: text) }
    Function("configure") { (maxBytes: Int, keepDays: Int) in TelemetryLocalStore.configure(maxBytes: maxBytes, keepDays: keepDays) }
    AsyncFunction("prune") { (now: Double, promise: Promise) in
      TelemetryLocalStore.pruneAndMeasure(now: now) { stats, writeMs in
        promise.resolve([
          "bytes": stats.bytes, "lines": stats.lines, "files": stats.files, "droppedLines": stats.droppedLines,
          "pruneMs": stats.pruneMs, "writeMs": writeMs,
        ])
      }
    }
    AsyncFunction("clear") { (promise: Promise) in TelemetryLocalStore.clear { promise.resolve(nil) } }
    AsyncFunction("exportForReport") { (since: Double, promise: Promise) in
      TelemetryLocalStore.exportForReport(since: since) { promise.resolve(Self.reply($0)) }
    }
    AsyncFunction("exportToDownloads") { (now: Double, promise: Promise) in
      TelemetryLocalStore.exportToDownloads(now: now) { promise.resolve(Self.reply($0)) }
    }
  }
}
