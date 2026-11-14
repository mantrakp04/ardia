import Foundation

extension SyncedDevice {
  public var detail: String? {
    isCurrent ? ThisDevice(kind: kind).title : nil
  }
}
