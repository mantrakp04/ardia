import Foundation
import LocalAuthentication

enum VaultOwnerCheck {
  static func confirm(_ reason: String) async -> Bool {
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
