import ArdiaSync
import SwiftUI

struct SyncStatusWords {
  enum Attention: Equatable {
    case none
    case folder
    case phrase
    case reset
    case stalled
  }

  let phase: SyncPhase
  let statusText: String
  let isEnabled: Bool

  init(sync: SyncService) {
    phase = sync.phase
    statusText = sync.statusText
    isEnabled = sync.isEnabled
  }

  init(phase: SyncPhase, statusText: String, isEnabled: Bool) {
    self.phase = phase
    self.statusText = statusText
    self.isEnabled = isEnabled
  }

  var isOff: Bool {
    phase == .off
  }

  var attention: Attention {
    switch phase {
    case .needsFolderAccess: .folder
    case .locked: .phrase
    case .reset: .reset
    case .stalled: .stalled
    default: .none
    }
  }

  var rowTitle: LocalizedStringKey {
    "Sync With Mac"
  }

  var rowSubtitle: Text {
    switch attention {
    case .folder: Text("Choose Your Sync Folder Again").foregroundStyle(.ink(.orange))
    case .phrase: Text("Enter Your Recovery Phrase").foregroundStyle(.ink(.orange))
    case .reset: Text("Out of Sync").foregroundStyle(.ink(.orange))
    case .stalled: Text(verbatim: statusText).foregroundStyle(.ink(.orange))
    case .none:
      isOff ? Text("Every tab, anywhere.") : Text(verbatim: statusText)
    }
  }

  var heroSubtitle: Text {
    if isOff {
      return Text("Your Mac’s tabs here, and this iPhone’s on your Mac.")
    }
    switch attention {
    case .none: return Text(verbatim: statusText)
    default: return Text(verbatim: statusText).foregroundStyle(.ink(.orange))
    }
  }

  var isConnected: Bool {
    switch phase {
    case .starting, .updating, .updated, .stalled, .offline, .needsFolderAccess: isEnabled
    case .off, .locked, .reset: false
    }
  }
}

enum SyncDeviceSymbol {
  static func name(for kind: SyncedDevice.Kind, deviceName: String) -> String {
    switch kind {
    case .phone: return "iphone"
    case .mac:
      let lower = deviceName.lowercased()
      if lower.contains("macbook") { return "laptopcomputer" }
      if lower.contains("imac") { return "desktopcomputer" }
      if lower.contains("studio") { return "macstudio" }
      if lower.contains("mini") { return "macmini" }
      return "desktopcomputer"
    }
  }
}
