import Foundation

enum VaultLockPolicy {
  static let unlockedAtQuitAccount = "unlocked-at-quit"
  static let sameBootSlack: TimeInterval = 1

  private static let lock = NSLock()
  nonisolated(unsafe) private static var locksOnQuit = true
  nonisolated(unsafe) private static var locksWithScreen = true
  nonisolated(unsafe) private static var openProviders: [String] = []

  static var locksOnScreenLock: Bool {
    lock.lock()
    defer { lock.unlock() }
    return locksWithScreen
  }

  static func set(lockOnQuit: Bool, lockOnScreenLock: Bool) {
    lock.lock()
    locksOnQuit = lockOnQuit
    locksWithScreen = lockOnScreenLock
    lock.unlock()
    if lockOnQuit { forgetUnlockedAtQuit() }
  }

  static func noteOpen(_ providers: [String]) {
    lock.lock()
    openProviders = providers
    lock.unlock()
  }

  static func recordQuit() {
    lock.lock()
    let staysOpen = !locksOnQuit
    let open = openProviders
    lock.unlock()
    let booted = bootedAt
    guard staysOpen, !open.isEmpty, booted > 0, VaultSessionStore.shared.touchID else { return forgetUnlockedAtQuit() }
    let marker: [String: Any] = ["bootedAt": booted, "providers": open]
    guard let data = try? JSONSerialization.data(withJSONObject: marker), let text = String(data: data, encoding: .utf8) else { return }
    VaultKeychain.write(unlockedAtQuitAccount, text)
  }

  static func takeUnlockedAtQuit() -> [String] {
    guard VaultKeychain.contains(unlockedAtQuitAccount) else { return [] }
    let text = VaultKeychain.read(unlockedAtQuitAccount)
    forgetUnlockedAtQuit()
    guard let data = text?.data(using: .utf8), let marker = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let booted = marker["bootedAt"] as? Double, booted > 0, abs(booted - bootedAt) < sameBootSlack,
      let providers = marker["providers"] as? [String]
    else { return [] }
    return providers.filter { VaultRegistry.provider($0) != nil }
  }

  static func forgetUnlockedAtQuit() {
    VaultKeychain.delete(unlockedAtQuitAccount)
  }

  private static var bootedAt: Double {
    var boot = timeval()
    var size = MemoryLayout<timeval>.stride
    var name: [Int32] = [CTL_KERN, KERN_BOOTTIME]
    guard sysctl(&name, 2, &boot, &size, nil, 0) == 0 else { return 0 }
    return Double(boot.tv_sec) + Double(boot.tv_usec) / 1_000_000
  }
}
