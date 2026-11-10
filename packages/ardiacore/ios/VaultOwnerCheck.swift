import Foundation
import LocalAuthentication

enum VaultOwnerCheck {
  private static let grantLifetime: TimeInterval = 10
  private static let presenceLifetime: TimeInterval = 30
  private static let grantLock = NSLock()
  nonisolated(unsafe) private static var grantedAt: Date?
  nonisolated(unsafe) private static var confirmedAt: Date?

  static func grant() {
    grantLock.lock()
    grantedAt = Date()
    confirmedAt = grantedAt
    grantLock.unlock()
  }

  static var recentlyConfirmed: Bool {
    grantLock.lock()
    defer { grantLock.unlock() }
    return confirmedAt.map { Date().timeIntervalSince($0) < presenceLifetime } ?? false
  }

  private static func noteConfirmed() {
    grantLock.lock()
    confirmedAt = Date()
    grantLock.unlock()
  }

  static func takeGrant() -> Bool {
    grantLock.lock()
    defer { grantLock.unlock() }
    let fresh = grantedAt.map { Date().timeIntervalSince($0) < grantLifetime } ?? false
    grantedAt = nil
    return fresh
  }

  static var biometricsAvailable: Bool {
    var problem: NSError?
    return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &problem)
  }

  static func confirm(_ reason: String) async -> Bool {
    let confirmed = await ask(reason)
    if confirmed { noteConfirmed() }
    return confirmed
  }

  private static func ask(_ reason: String) async -> Bool {
    if takeGrant() { return true }
    let config = LaunchConfig.shared
    if config.background {
      let granted = config.testValue("reauth") == "granted"
      NSLog("[vaults] owner check (%@) in a hidden test instance, no prompt: %@", reason, granted ? "granted" : "denied")
      return granted
    }
    if let biometric = await evaluate(.deviceOwnerAuthenticationWithBiometrics, reason) { return biometric }
    return await evaluate(.deviceOwnerAuthentication, reason) ?? false
  }

  private static func evaluate(_ policy: LAPolicy, _ reason: String) async -> Bool? {
    await withCheckedContinuation { (done: CheckedContinuation<Bool?, Never>) in
      let context = LAContext()
      var problem: NSError?
      guard context.canEvaluatePolicy(policy, error: &problem) else { return done.resume(returning: nil) }
      context.evaluatePolicy(policy, localizedReason: reason) { granted, error in
        withExtendedLifetime(context) {
          if granted { return done.resume(returning: true) }
          let fellBack = (error as? LAError)?.code == .userFallback
          done.resume(returning: fellBack ? nil : false)
        }
      }
    }
  }
}
