import Foundation

enum VaultSandbox {
  static var directory: String? {
    LaunchConfig.shared.background ? LaunchConfig.shared.dataDirectory : nil
  }
}
