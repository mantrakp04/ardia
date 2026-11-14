import ArdiaBrowser
import Foundation
import notify
import UIKit

@MainActor
final class ProximityFeed {
  static let scriptKey = "ArdiaProximity"
  static let nearNotification = "com.ardia.browser.ios.proximity.near"
  static let farNotification = "com.ardia.browser.ios.proximity.far"

  var onChange: ((Bool) -> Void)?

  private var observer: NSObjectProtocol?
  private var scriptTask: Task<Void, Never>?
  private var notifyTokens: [Int32] = []

  func start() {
    stop()
    let device = UIDevice.current
    device.isProximityMonitoringEnabled = true
    if device.isProximityMonitoringEnabled {
      observer = NotificationCenter.default.addObserver(forName: UIDevice.proximityStateDidChangeNotification, object: device, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.onChange?(UIDevice.current.proximityState) }
      }
    }
    if let script = UserDefaults.standard.string(forKey: Self.scriptKey).flatMap(ProximityScript.init) {
      play(script)
    }
    #if targetEnvironment(simulator) || DEBUG
    listen(Self.nearNotification, isNear: true)
    listen(Self.farNotification, isNear: false)
    #endif
  }

  func stop() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    UIDevice.current.isProximityMonitoringEnabled = false
    scriptTask?.cancel()
    scriptTask = nil
    for token in notifyTokens { notify_cancel(token) }
    notifyTokens = []
  }

  private func play(_ script: ProximityScript) {
    scriptTask = Task { [weak self] in
      let start = ContinuousClock.now
      for step in script.steps {
        try? await Task.sleep(until: start + .milliseconds(Int(step.after * 1000)), clock: .continuous)
        guard !Task.isCancelled else { return }
        self?.onChange?(step.isNear)
      }
    }
  }

  private func listen(_ name: String, isNear: Bool) {
    var token: Int32 = 0
    let status = notify_register_dispatch(name, &token, .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.onChange?(isNear) }
    }
    if status == NOTIFY_STATUS_OK { notifyTokens.append(token) }
  }
}
