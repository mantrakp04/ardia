import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SyncSettingsPage: View {
  @Environment(AppModel.self) private var app
  @State private var isSyncing = false
  @State private var syncs = 0
  @State private var syncFailures = 0
  @State private var stops = 0
  @State private var isChoosingFolder = false
  @State private var isConfirmingStop = false
  @State private var isStopping = false
  @State private var folderError: String?

  var body: some View {
    let sync = app.sync
    let words = SyncStatusWords(sync: sync)
    Form {
      SettingsHero("Sync With Mac", subtitle: words.heroSubtitle, systemImage: "macbook.and.iphone", tint: SettingsTint.sync) {
        if words.isOff {
          NavigationLink(value: SettingsRoute.connect) {
            Text("Connect to Your Mac")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .buttonBorderShape(.capsule)
          .controlSize(.large)
          .tint(Palette.indigo)
          .padding(.top, Spacing.tight)
        }
      }

      if words.isOff {
        offSections
      } else {
        attentionSection(words.attention)
        if words.isConnected { connectedSections(sync) }
      }
    }
    .settingsPage("Sync With Mac")
    .refreshable {
      guard sync.isEnabled else { return }
      await sync.syncNow()
    }
    .animation(Motion.smooth, value: words.isOff)
    .folderPicker(isPresented: $isChoosingFolder) { url in
      Task {
        let result = await sync.changeFolder(url)
        folderError = result.message
      }
    }
    .confirmationDialog("Stop Syncing This Device?", isPresented: $isConfirmingStop, titleVisibility: .visible) {
      Button("Stop Syncing", role: .destructive) {
        stops += 1
        isStopping = true
        Task {
          await sync.stopSyncing()
          isStopping = false
        }
      }
    } message: {
      Text("To sync again, you’ll need your Mac’s code or your recovery phrase.")
    }
    .sensoryFeedback(.success, trigger: syncs)
    .sensoryFeedback(.error, trigger: syncFailures)
    .sensoryFeedback(.warning, trigger: stops)
  }

  @ViewBuilder
  private var offSections: some View {
    Section {
      SyncFeatureRow(symbol: "macbook", title: "Your Mac’s Tabs")
      SyncFeatureRow(symbol: "pin.fill", title: "Pinned Tabs and Spaces")
      SyncFeatureRow(symbol: "paperplane.fill", title: "Send Tabs Both Ways")
      SyncFeatureRow(symbol: "clock.arrow.circlepath", title: "History and Bookmarks")
    } header: {
      Text("What You Get")
    } footer: {
      Text("End-to-end encrypted, in your own iCloud Drive.")
    }
  }

  @ViewBuilder
  private func attentionSection(_ attention: SyncStatusWords.Attention) -> some View {
    switch attention {
    case .folder:
      Section {
        Button("Choose Folder…") { isChoosingFolder = true }
      } footer: {
        Text("Choose the Ardia Sync folder again.")
      }
    case .phrase, .reset:
      Section {
        NavigationLink(value: SettingsRoute.connect) {
          Text(attention == .phrase ? "Enter Recovery Phrase" : "Connect Again")
        }
      } footer: {
        if attention == .reset {
          Text("Tabs on this iPhone stay.")
        }
      }
    case .none, .stalled:
      EmptyView()
    }
  }

  @ViewBuilder
  private func connectedSections(_ sync: SyncService) -> some View {
    @Bindable var sync = sync
    Section {
      Button {
        guard !isSyncing else { return }
        isSyncing = true
        Task {
          await sync.syncNow()
          isSyncing = false
          switch sync.phase {
          case .updated: syncs += 1
          case .stalled, .offline, .needsFolderAccess, .locked, .reset: syncFailures += 1
          case .off, .starting, .updating: break
          }
        }
      } label: {
        HStack {
          Text(isSyncing ? "Syncing…" : "Sync Now")
          Spacer()
          if isSyncing {
            ProgressView()
          }
        }
      }
      .disabled(isSyncing)
    }

    let others = sync.snapshot.devices.sorted(by: DeviceOrder.areInIncreasingOrder)
    if !others.isEmpty {
      Section {
        ForEach(others) { device in
          SyncDeviceRow(device: device)
        }
      } header: {
        Text("Devices")
      } footer: {
        if sync.devicesThatReceiveTabs.isEmpty {
          Text("Update Ardia on your Mac to send tabs to it.")
        }
      }
    }

    Section {
      TextField("Name", text: $sync.deviceName)
        .textInputAutocapitalization(.words)
        .submitLabel(.done)
    } header: {
      Text("This iPhone’s Name")
    } footer: {
      Text("Shown on your Mac.")
    }

    Section {
      LabeledContent("Folder", value: sync.folderName ?? String(localized: "Ardia Sync"))
      Button("Change Folder…") { isChoosingFolder = true }
    } header: {
      Text("Sync Folder")
    } footer: {
      if let folderError {
        Text(folderError).foregroundStyle(.ink(.red))
      } else {
        Text("Encrypted so only your devices can read it.")
      }
    }

    Section {
      Button(role: .destructive) {
        isConfirmingStop = true
      } label: {
        HStack {
          Text("Stop Syncing…")
          Spacer()
          if isStopping { ProgressView() }
        }
      }
      .disabled(isStopping)
    } footer: {
      Text("Your Mac stops seeing this iPhone’s tabs.")
    }
  }
}

private struct SyncFeatureRow: View {
  var symbol: String
  var title: LocalizedStringKey
  @ScaledMetric(relativeTo: .body) private var symbolWidth: CGFloat = 28

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
      Image(systemName: symbol)
        .font(.body.weight(.semibold))
        .foregroundStyle(Palette.indigo)
        .frame(width: symbolWidth)
        .accessibilityHidden(true)
      Text(title)
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}

struct SyncDeviceRow: View {
  let device: SyncedDevice

  var body: some View {
    LabeledContent {
      Text(lastSeen)
    } label: {
      Label {
        Text(verbatim: device.name)
      } icon: {
        Image(systemName: SyncDeviceSymbol.name(for: device.kind, deviceName: device.name))
          .foregroundStyle(.secondary)
      }
    }
  }

  private var lastSeen: String {
    if device.isCurrent { return String(localized: "This iPhone") }
    guard let lastSeen = device.lastSeen else { return String(localized: "Not Yet Synced") }
    if Date.now.timeIntervalSince(lastSeen) < 60 { return String(localized: "Just Now") }
    return lastSeen.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
  }
}

enum DeviceOrder {
  static func areInIncreasingOrder(_ a: SyncedDevice, _ b: SyncedDevice) -> Bool {
    if a.isCurrent != b.isCurrent { return !a.isCurrent }
    return (a.lastSeen ?? .distantPast) > (b.lastSeen ?? .distantPast)
  }
}

#Preview("Sync On") {
  NavigationStack {
    SyncSettingsPage()
  }
  .environment(AppModel(isDemo: true))
}
