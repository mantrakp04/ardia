import AppKit

final class VaultAutoLock {
  static let shared = VaultAutoLock()
  static let screenLocked = Notification.Name("com.apple.screenIsLocked")
  static let idleCheckInterval: TimeInterval = 60

  private var observers: [NSObjectProtocol] = []
  private var timer: Timer?

  func start() {
    DispatchQueue.main.async { self.begin() }
  }

  private func begin() {
    guard timer == nil else { return }
    timer = Timer.scheduledTimer(withTimeInterval: Self.idleCheckInterval, repeats: true) { _ in
      Task { await VaultBroker.shared.lockIdle() }
    }
    guard !LaunchConfig.shared.background else { return }
    let workspace = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
      observers.append(workspace.addObserver(forName: name, object: nil, queue: .main) { _ in VaultAutoLock.lockEverything() })
    }
    observers.append(
      DistributedNotificationCenter.default().addObserver(forName: Self.screenLocked, object: nil, queue: .main) { _ in
        VaultAutoLock.lockEverything()
      })
  }

  private static func lockEverything() {
    ArdiaWebView.wipeVaultCaptures()
    Task { await VaultBroker.shared.lockAll() }
  }
}
