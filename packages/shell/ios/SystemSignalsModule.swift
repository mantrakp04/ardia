import AppKit
import ArdiaCore
import ExpoModulesCore

final class IdleWatch {
  private static let anyInput = CGEventType(rawValue: UInt32.max)!

  private let queue = DispatchQueue(label: "dev.ardia.idle-watch", qos: .utility)
  private var timer: DispatchSourceTimer?
  private var idleByThreshold: [Double: Bool] = [:]
  private let onChange: (Double, Bool) -> Void

  init(onChange: @escaping (Double, Bool) -> Void) {
    self.onChange = onChange
  }

  func watch(_ thresholds: [Double]) {
    queue.async { [self] in
      let wanted = Set(thresholds.filter { $0.isFinite && $0 > 0 })
      idleByThreshold = Dictionary(uniqueKeysWithValues: wanted.map { ($0, idleByThreshold[$0] ?? false) })
      if wanted.isEmpty { return stopTimer() }
      tick()
    }
  }

  func stop() {
    queue.async { [self] in
      idleByThreshold = [:]
      stopTimer()
    }
  }

  private func stopTimer() {
    timer?.cancel()
    timer = nil
  }

  private func tick() {
    guard !idleByThreshold.isEmpty else { return stopTimer() }
    let idle = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: Self.anyInput)
    for (threshold, was) in idleByThreshold where (idle >= threshold) != was {
      idleByThreshold[threshold] = !was
      onChange(threshold, !was)
    }
    schedule(after: nextCheck(idle))
  }

  private func nextCheck(_ idle: Double) -> Double {
    var delay = idleByThreshold.filter { !$0.value }.keys.map { $0 - idle }.min() ?? .infinity
    if idleByThreshold.values.contains(true), let smallest = idleByThreshold.keys.min() {
      delay = min(delay, min(max(smallest / 4, 0.5), 2))
    }
    return min(max(delay, 0.25), 60)
  }

  private func schedule(after seconds: Double) {
    if timer == nil {
      let source = DispatchSource.makeTimerSource(queue: queue)
      source.setEventHandler { [weak self] in self?.tick() }
      source.resume()
      timer = source
    }
    timer?.schedule(deadline: .now() + seconds, leeway: .milliseconds(Int(seconds * 100)))
  }
}

public class SystemSignalsModule: Module {
  private static let event = "onSystemSignal"

  private let lifetime = ModuleLifetime()
  private var sleepObservers: [NSObjectProtocol] = []
  private var asleep = false
  private lazy var idle = IdleWatch { [weak self] threshold, idle in
    DispatchQueue.main.async { self?.send(["type": "idle", "threshold": threshold, "idle": idle]) }
  }

  public func definition() -> ModuleDefinition {
    Name("ArdiaSystemSignals")
    Events(Self.event)

    OnCreate {
      self.lifetime.begin(self) {
        for token in self.sleepObservers { NSWorkspace.shared.notificationCenter.removeObserver(token) }
        self.sleepObservers = []
        self.idle.stop()
      }
      self.lifetime.onMain { [weak self] in self?.observeSleep() }
    }

    OnDestroy { self.lifetime.end() }

    Function("watchIdle") { (thresholds: [Double]) in
      self.lifetime.run { self.idle.watch(thresholds) }
    }

    Function("holdsIncomingLinks") { () -> Bool in ArdiaHost.holdsIncomingLinks }

    Function("setHoldIncomingLinks") { (hold: Bool, hooksStamp: String?) in ArdiaHost.setHoldIncomingLinks(hold, hooksStamp: hooksStamp) }

    Function("setApprovedDownloadFolders") { (folders: [String]) in ArdiaDownloadMover.shared.setApprovedFolders(folders) }

    AsyncFunction("moveCompletedDownload") { (path: String, folder: String) -> [String: Any] in
      var result = ArdiaDownloadMover.shared.moveDownload(at: path, toFolder: folder)
      if let event = result.removeValue(forKey: "event") as? [String: Any] {
        DispatchQueue.main.async { ArdiaEvents.emit("downloads.changed", data: event) }
      }
      return result
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))

    AsyncFunction("devPost") { (name: String) -> Bool in
      guard LaunchConfig.shared.isolated else { return false }
      let notification: [String: Notification.Name] = ["willSleep": NSWorkspace.willSleepNotification, "didWake": NSWorkspace.didWakeNotification]
      guard let posted = notification[name] else { return false }
      NSWorkspace.shared.notificationCenter.post(name: posted, object: NSWorkspace.shared)
      return true
    }.runOnQueue(.main)
  }

  private func observeSleep() {
    let center = NSWorkspace.shared.notificationCenter
    sleepObservers = [
      center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.setAsleep(true) },
      center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.setAsleep(false) },
    ]
  }

  private func setAsleep(_ value: Bool) {
    guard value != asleep else { return }
    asleep = value
    send(["type": value ? "sleep" : "wake"])
  }

  private func send(_ body: [String: Any]) {
    guard lifetime.isAlive, appContext != nil else { return }
    sendEvent(Self.event, body)
  }
}
