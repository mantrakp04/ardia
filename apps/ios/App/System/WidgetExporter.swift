import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import Foundation
import UIKit
import WidgetKit

@MainActor
final class WidgetExporter {
  static let macTabsKind = "MacTabs"
  static let searchKinds = ["Search", "SearchLockScreen", "SearchLockScreenRectangular", "VoiceSearchLockScreen"]
  static let faviconSide: CGFloat = 64
  static let faviconBudget = 24

  private var last: SystemSnapshot?
  private var faviconTask: Task<Void, Never>?
  private var failedHosts: Set<String> = []

  func export(_ snapshot: SystemSnapshot, from app: AppModel) {
    guard let store = app.systemStore else { return }
    if last == nil { last = store.loadSnapshot() }
    guard snapshot != last else { return }
    let searchChanged = snapshot.isBrowseForMeAvailable != last?.isBrowseForMeAvailable || snapshot.gradient != last?.gradient
    guard store.save(snapshot) else { return }
    last = snapshot
    WidgetCenter.shared.reloadTimelines(ofKind: Self.macTabsKind)
    if searchChanged {
      for kind in Self.searchKinds { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
    }
    fetchFavicons(for: snapshot, into: store)
  }

  static func snapshot(for app: AppModel) -> SystemSnapshot {
    let sync = app.sync
    guard sync.isEnabled, let profile = sync.selectedProfile ?? sync.snapshot.defaultProfile else {
      return SystemSnapshot(isSyncEnabled: sync.isEnabled, isBrowseForMeAvailable: app.isBrowseForMeAvailable)
    }
    let devices = sync.snapshot.devices
    let current = Set(devices.filter(\.isCurrent).map(\.id))
    let lastSeen = Dictionary(devices.map { ($0.id, $0.lastSeen ?? .distantPast) }, uniquingKeysWith: max)
    let macs = profile.deviceTabs
      .filter { $0.kind == .mac && !current.contains($0.deviceId) }
      .sorted { (lastSeen[$0.deviceId] ?? .distantPast) > (lastSeen[$1.deviceId] ?? .distantPast) }
      .map { group in
        SystemDeviceTabs(
          device: SystemDevice(id: group.deviceId, name: group.deviceName, kind: .mac),
          tabs: group.tabs
            .filter { BrowserURL.isSyncable($0.url) }
            .prefix(SystemSnapshot.tabLimitPerDevice)
            .map { tab in
              SystemTab(title: tab.title, url: tab.url, favicon: BrowserURL.host(of: tab.url).map(SystemStore.faviconName(forHost:)))
            }
        )
      }
    let targets = sync.devicesThatReceiveTabs(in: profile.syncId).map {
      SystemDevice(id: $0.id, name: $0.name, kind: $0.kind == .mac ? .mac : .phone)
    }
    return SystemSnapshot(
      isSyncEnabled: true,
      macTabs: macs,
      sendTargets: targets,
      gradient: profile.theme?.colors ?? [],
      isBrowseForMeAvailable: app.isBrowseForMeAvailable
    )
  }

  private func fetchFavicons(for snapshot: SystemSnapshot, into store: SystemStore) {
    var hosts: [String] = []
    for tab in snapshot.macTabs.flatMap(\.tabs) {
      guard let host = tab.host, let name = tab.favicon, !store.hasFavicon(named: name),
        !failedHosts.contains(host), !hosts.contains(host)
      else { continue }
      hosts.append(host)
    }
    guard !hosts.isEmpty else { return }
    faviconTask?.cancel()
    faviconTask = Task { [weak self] in
      var saved = 0
      for host in hosts.prefix(Self.faviconBudget) {
        guard !Task.isCancelled else { return }
        if let data = await FaviconFetcher.png(forHost: host, side: Self.faviconSide),
          store.saveFavicon(data, named: SystemStore.faviconName(forHost: host))
        {
          saved += 1
        } else {
          self?.failedHosts.insert(host)
        }
      }
      if saved > 0 { WidgetCenter.shared.reloadTimelines(ofKind: Self.macTabsKind) }
    }
  }
}

nonisolated enum FaviconFetcher {
  static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 8
    configuration.httpAdditionalHeaders = ["Accept": "image/*"]
    return URLSession(configuration: configuration)
  }()

  static func png(forHost host: String, side: CGFloat) async -> Data? {
    for path in ["/apple-touch-icon.png", "/favicon.ico"] {
      guard let url = URL(string: "https://\(host)\(path)") else { continue }
      guard let (data, response) = try? await session.data(from: url),
        (response as? HTTPURLResponse)?.statusCode == 200, data.count < 2_000_000,
        let image = UIImage(data: data), image.size.width >= 16
      else { continue }
      return await render(image, side: side)
    }
    return nil
  }

  @concurrent
  static func render(_ image: UIImage, side: CGFloat) async -> Data? {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let size = CGSize(width: side, height: side)
    return UIGraphicsImageRenderer(size: size, format: format).pngData { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
  }
}
