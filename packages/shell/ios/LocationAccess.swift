import AppKit
import ArdiaCore
import CoreLocation

final class LocationAccess: NSObject, CLLocationManagerDelegate {
  static let shared = LocationAccess()

  private static let answerDeadline: TimeInterval = 180

  private lazy var manager: CLLocationManager = {
    let manager = CLLocationManager()
    manager.delegate = self
    return manager
  }()
  private var waiting: [(String) -> Void] = []
  private var deadline: DispatchWorkItem?
  private var fakeStatus: String? = LocationAccess.initialFakeStatus()

  private static func initialFakeStatus() -> String? {
    let config = LaunchConfig.shared
    if let value = config.testValue("systemLocationPermission") {
      return value == "ask" ? "notDetermined" : value
    }
    return config.background ? "notDetermined" : nil
  }

  private var promptsAllowed: Bool { fakeStatus == nil }

  func status() -> String {
    if let fakeStatus { return fakeStatus }
    guard CLLocationManager.locationServicesEnabled() else { return "servicesOff" }
    return Self.name(manager.authorizationStatus)
  }

  func request(_ done: @escaping (String) -> Void) {
    let current = status()
    guard current == "notDetermined" else { return done(current) }
    guard promptsAllowed else {
      fakeRequests += 1
      if LaunchConfig.shared.testValue("systemLocationPermission") == "ask" { fakeStatus = "granted" }
      return done(status())
    }
    waiting.append(done)
    guard waiting.count == 1 else { return }
    let deadline = DispatchWorkItem { [weak self] in self?.finish() }
    self.deadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.answerDeadline, execute: deadline)
    manager.requestWhenInUseAuthorization()
  }

  private(set) var fakeRequests = 0

  func openSettings() {
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices") {
      NSWorkspace.shared.open(url)
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus != .notDetermined { finish() }
  }

  private func finish() {
    deadline?.cancel()
    deadline = nil
    let callbacks = waiting
    waiting = []
    let answer = status()
    callbacks.forEach { $0(answer) }
  }

  private static func name(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    default: return "granted"
    }
  }
}
