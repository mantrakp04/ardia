import Foundation

struct Toast: Identifiable, Equatable {
  let id: UUID
  var message: String
  var symbol: String
  var duration: Duration
  var onTap: (@MainActor () -> Void)?

  init(
    _ message: String,
    symbol: String,
    duration: Duration = .seconds(2.4),
    onTap: (@MainActor () -> Void)? = nil
  ) {
    id = UUID()
    self.message = message
    self.symbol = symbol
    self.duration = duration
    self.onTap = onTap
  }

  static func == (lhs: Toast, rhs: Toast) -> Bool {
    lhs.id == rhs.id
  }
}

extension Toast {
  static var copiedURL: Toast {
    Toast(String(localized: "Copied URL"), symbol: "link")
  }

  static var copiedURLWithoutTrackers: Toast {
    Toast(String(localized: "Copied URL Without Trackers"), symbol: "link")
  }

  static var clearedBrowsingData: Toast {
    Toast(String(localized: "Cleared Browsing Data"), symbol: "eraser.fill")
  }

  static var noOpenTabsToExport: Toast {
    Toast(String(localized: "There are no open tabs to export."), symbol: "square.on.square.dashed")
  }

  static var syncConnected: Toast {
    Toast(String(localized: "Syncing With Your Mac"), symbol: "checkmark.icloud.fill")
  }

  static func tabReceived(from deviceName: String, count: Int = 1, onOpen: (@MainActor () -> Void)? = nil) -> Toast {
    let message = count == 1
      ? String(localized: "Tab from \(deviceName)")
      : String(localized: "\(count.formatted()) Tabs from \(deviceName)")
    return Toast(
      message,
      symbol: deviceName.localizedCaseInsensitiveContains("iPhone") ? "iphone" : "macbook",
      duration: .seconds(3.2),
      onTap: onOpen
    )
  }

  static func sentTab(to deviceName: String) -> Toast {
    Toast(String(localized: "Sent to \(deviceName)"), symbol: "paperplane.fill")
  }
}
