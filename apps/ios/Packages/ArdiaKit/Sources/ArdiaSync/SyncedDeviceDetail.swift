import Foundation

extension SyncedDevice {
  public var detail: String? {
    isCurrent ? String(localized: "This iPhone") : nil
  }
}
