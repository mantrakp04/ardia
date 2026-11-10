import Foundation

struct VaultSyncResult: Sendable {
  var synced: [String] = []
  var failed: [String] = []
  var syncedAt: Double?
  var iCloud = false

  func jsonObject() -> [String: Any] {
    ["ok": failed.isEmpty, "synced": synced, "failed": failed, "syncedAt": syncedAt.map { $0 as Any } ?? NSNull(), "iCloud": iCloud]
  }
}
