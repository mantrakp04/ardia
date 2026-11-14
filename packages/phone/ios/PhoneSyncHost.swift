import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import Foundation
import Observation
import PhoneSync

@MainActor
public final class PhoneSyncHost {
  public static let shared = PhoneSyncHost()

  static var folder: URL { URL.applicationSupportDirectory.appending(path: "PhoneSync", directoryHint: .isDirectory) }
  static var database: URL { URL.documentsDirectory.appending(path: "SQLite/browser.db") }

  public static var legacyGate: LegacyImportGate {
    LegacyImportGate(
      legacyStores: PhoneLegacy.storeFolders.map { $0.appending(path: "Browser.store") },
      marker: folder.appending(path: "legacy-imported.json")
    )
  }

  enum Change {
    case status
    case view
    case incoming
    case inbox(Int)
  }

  let inbox: PhoneInbox
  private let source: PhoneBrowsingSource
  private(set) var service: SyncService
  private(set) var isDemo = false
  private var launched = false
  private var replacing: Task<Void, Never>?
  private var generation = 0
  private var announced = Set<String>()
  private(set) var incoming: [ReceivedTab] = []
  private let exporter = WidgetExporter()

  private(set) var listener: ((Change) -> Void)?
  private weak var listenerOwner: AnyObject?

  func listen(_ owner: AnyObject, _ handler: @escaping (Change) -> Void) {
    listenerOwner = owner
    listener = handler
  }

  func stopListening(_ owner: AnyObject) {
    guard listenerOwner === owner else { return }
    listenerOwner = nil
    listener = nil
  }

  private init() {
    try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
    var folder = Self.folder
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? folder.setResourceValues(values)
    inbox = PhoneInbox(file: Self.folder.appending(path: "inbox.json"))
    source = PhoneBrowsingSource(database: Self.database, inbox: inbox, isReady: { !PhoneSyncHost.legacyGate.holdsSync })
    service = SyncService()
    service.source = source
    source.onReceived = { [weak self] tabs in self?.announce(tabs) }
    inbox.onChange = { [weak self] count in
      Task { @MainActor in self?.listener?(.inbox(count)) }
    }
    inbox.onProblem = { [weak self] _ in
      Task { @MainActor in self?.listener?(.status) }
    }
  }

  public func launch() {
    guard !launched else { return }
    launched = true
    SyncService.registerBackgroundRefresh()
    inbox.load()
    service.start()
    track()
  }

  public func sceneBecameActive() {
    service.appBecameActive()
  }

  public func sceneWillResignActive() {
    service.appWillResignActive()
  }

  func ready() async -> SyncService {
    if let replacing { await replacing.value }
    return service
  }

  func useDemoIfAsked() async {
    guard PhoneTestBuild.flag("ArdiaSyncDemo") else { return }
    await useDemo()
  }

  func useDemo() async {
    if let replacing { return await replacing.value }
    guard PhoneTestBuild.isOn, !isDemo, !service.isEnabled, service.folderName == nil else { return }
    let old = service
    let task = Task { @MainActor in
      await old.close()
      let demo = SyncService.demo
      self.service = demo
      self.isDemo = true
      self.announced = []
      self.incoming = []
      self.track()
      self.listener?(.status)
      self.listener?(.view)
    }
    replacing = task
    await task.value
    replacing = nil
  }

  func legacyImportFinished() {
    guard !PhoneSyncHost.legacyGate.holdsSync else { return }
    service.localDidChange()
    Task { await service.syncNow() }
  }

  func stopSyncing() async {
    await ready().stopSyncing()
    announced = []
    incoming = []
    listener?(.incoming)
  }

  func clearIncoming() {
    incoming = []
  }

  private func announce(_ tabs: [ReceivedTab]) {
    let fresh = tabs.filter { announced.insert($0.key).inserted }
    guard !fresh.isEmpty else { return }
    incoming = fresh
    listener?(.incoming)
  }

  private func track() {
    generation += 1
    let current = generation
    trackStatus(current)
    trackView(current)
  }

  private func trackStatus(_ current: Int) {
    let service = service
    withObservationTracking {
      _ = (service.phase, service.isEnabled, service.pendingDownloads, service.lastSynced, service.folderName, service.deviceName, service.selectedProfileId)
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.generation == current else { return }
        self.listener?(.status)
        self.trackStatus(current)
      }
    }
  }

  private func trackView(_ current: Int) {
    let service = service
    let widget = withObservationTracking {
      _ = (service.snapshot, service.selectedProfileId, service.isEnabled)
      return WidgetExporter.snapshot(sync: service, colorChoice: nil)
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, self.generation == current else { return }
        self.listener?(.view)
        self.trackView(current)
      }
    }
    if !isDemo, let store = SystemStore.shared { exporter.export(widget, into: store) }
  }
}
