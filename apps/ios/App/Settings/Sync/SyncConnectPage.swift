import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SyncConnectPage: View {
  var onConnected: (() -> Void)?

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var phrase = ""
  @State private var isScanning = false
  @State private var isEnteringWords = false
  @State private var isChoosingFolder = false
  @State private var isConnecting = false
  @State private var failure: String?
  @State private var scans = 0
  @State private var connections = 0
  @State private var connectFailures = 0
  @State private var pickedFolder: URL?

  var body: some View {
    let hasPhrase = app.sync.check(phrase: phrase).isValid
    Form {
      SettingsHero("Connect to Your Mac", subtitle: Text("Two steps, and your Mac’s tabs are here."), systemImage: "macbook.and.iphone", tint: SettingsTint.sync)

      Section {
        SetupStepRow(
          1,
          title: Text("Show the code on your Mac"),
          detail: Text("In Ardia on your Mac, open Settings › Sync and click Connect Another Device. Turn on sync there first if it’s off."),
          progress: .step(done: hasPhrase, after: true)
        ) {
          if hasPhrase {
            HStack(spacing: Spacing.tight) {
              Label("Recovery phrase added", systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.ink(.green))
              Spacer()
              Button("Change") { isEnteringWords = true }
                .font(.subheadline)
            }
          } else {
            ViewThatFits(in: .horizontal) {
              HStack(spacing: Spacing.tight) { phraseButtons }
              VStack(alignment: .leading, spacing: Spacing.tight) { phraseButtons }
            }
          }
        }

        SetupStepRow(
          2,
          title: Text("Choose the Ardia Sync folder"),
          detail: Text("Open iCloud Drive, select the Ardia Sync folder your Mac uses, and tap Use Folder. Ardia connects once both steps are done."),
          progress: .step(done: false, after: hasPhrase)
        ) {
          VStack(alignment: .leading, spacing: Spacing.tight) {
            if let pickedFolder, !isConnecting {
              Label {
                Text(verbatim: pickedFolder.lastPathComponent)
              } icon: {
                Image(systemName: "folder.fill")
              }
              .font(.subheadline.weight(.medium))
              .foregroundStyle(.secondary)
            }
            if isConnecting {
              HStack(spacing: Spacing.tight) {
                ProgressView()
                Text("Connecting…").foregroundStyle(.secondary)
              }
              .font(.subheadline)
            } else {
              Button(pickedFolder == nil ? "Choose Folder…" : "Choose Another Folder…") { isChoosingFolder = true }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            }
            if let failure {
              Text(failure)
                .font(.subheadline)
                .foregroundStyle(.ink(.red))
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity)
            }
          }
        }
      } header: {
        Text("Two Steps")
      } footer: {
        Text("Your recovery phrase stays in this iPhone’s Keychain. Ardia checks it against the folder before saving anything.")
      }
    }
    .settingsPage("Connect to Your Mac")
    .animation(Motion.snappy, value: hasPhrase)
    .animation(Motion.snappy, value: isConnecting)
    .animation(Motion.snappy, value: failure)
    .fullScreenCover(isPresented: $isScanning) {
      SyncCodeScannerSheet(
        isValid: { app.sync.check(phrase: $0).isValid },
        onScan: { code in
          phrase = code
          failure = nil
          if pickedFolder == nil { scans += 1 }
        },
        onEnterWords: { isEnteringWords = true }
      )
    }
    .navigationDestination(isPresented: $isEnteringWords) {
      RecoveryPhraseEntryPage(phrase: $phrase)
    }
    .folderPicker(isPresented: $isChoosingFolder) { folder in
      pickedFolder = folder
      failure = nil
      connectIfReady()
    }
    .onChange(of: hasPhrase) { _, _ in connectIfReady() }
    .sensoryFeedback(.success, trigger: scans)
    .sensoryFeedback(.success, trigger: connections)
    .sensoryFeedback(.error, trigger: connectFailures)
    .interactiveDismissDisabled(isConnecting)
    .navigationBarBackButtonHidden(isConnecting)
  }

  private var phraseButtons: some View {
    Group {
      Button("Scan Code", systemImage: "qrcode.viewfinder") { isScanning = true }
        .buttonStyle(.borderedProminent)
        .tint(Palette.indigo)
      Button("Enter Words", systemImage: "character.cursor.ibeam") { isEnteringWords = true }
        .buttonStyle(.bordered)
    }
    .labelStyle(.titleAndIcon)
    .buttonBorderShape(.capsule)
    .lineLimit(1)
    .fixedSize(horizontal: true, vertical: false)
  }

  private func connectIfReady() {
    guard let pickedFolder, !isConnecting, app.sync.check(phrase: phrase).isValid else { return }
    connect(folder: pickedFolder)
  }

  private func connect(folder: URL) {
    isConnecting = true
    failure = nil
    Task {
      let result = await app.sync.connect(phrase: phrase, folder: folder)
      isConnecting = false
      if let message = result.message {
        failure = message
        connectFailures += 1
        return
      }
      phrase = ""
      connections += 1
      app.toasts.show(.syncConnected)
      if let onConnected {
        onConnected()
      } else {
        dismiss()
      }
    }
  }
}

#Preview("Connect") {
  NavigationStack {
    SyncConnectPage()
  }
  .environment(AppModel(isDemo: true))
}
