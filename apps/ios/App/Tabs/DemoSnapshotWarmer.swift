import ArdiaBrowser
import UIKit
import WebKit

@MainActor
enum DemoSnapshotWarmer {
  static let loadTimeout: Duration = .seconds(10)
  static let settleDelay: Duration = .milliseconds(700)
  static let batchSize = 3

  static func warm(_ app: AppModel) async {
    guard app.isDemo else { return }
    await app.blocker.prepare()
    guard let window = keyWindow() else { return }
    let pending = app.tabs.openTabs.filter { $0.snapshotFileName == nil && BrowserURL.isSyncable($0.url) }
    var index = 0
    while index < pending.count {
      let batch = pending[index..<min(index + batchSize, pending.count)]
      let captures = batch.map { tab in
        let id = tab.id
        let url = tab.url
        return Task { await capture(id: id, url: url, app: app, window: window) }
      }
      for capture in captures { await capture.value }
      index += batchSize
    }
  }

  private static func capture(id: UUID, url: String, app: AppModel, window: UIWindow) async {
    guard let target = URL(string: url) else { return }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    app.blocker.install(on: configuration.userContentController, counter: BlockedResourceCounter())
    let size = window.bounds.size
    let webView = WKWebView(frame: CGRect(x: -size.width * 2, y: 0, width: size.width, height: size.height), configuration: configuration)
    webView.isUserInteractionEnabled = false
    window.insertSubview(webView, at: 0)
    defer { webView.removeFromSuperview() }
    webView.load(URLRequest(url: target))
    let start = ContinuousClock.now
    try? await Task.sleep(for: .milliseconds(500))
    while webView.isLoading, ContinuousClock.now - start < loadTimeout {
      try? await Task.sleep(for: .milliseconds(200))
    }
    try? await Task.sleep(for: settleDelay)
    let snapshot = WKSnapshotConfiguration()
    snapshot.snapshotWidth = NSNumber(value: Double(min(size.width, TabSnapshotStore.pointWidth)))
    guard let image = try? await webView.takeSnapshot(configuration: snapshot), let cgImage = image.cgImage else { return }
    let theme = webView.themeColor.flatMap(hex)
    let title = webView.title
    guard let name = await app.web.snapshots.save(cgImage, scale: image.scale, for: id) else { return }
    app.tabs.update(id, title: (title?.isEmpty == false) ? title : nil, themeColorHex: theme, snapshotFileName: name)
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.windows.first
  }

  private static func hex(_ color: UIColor) -> String? {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha), alpha > 0.5 else { return nil }
    func byte(_ value: CGFloat) -> Int { Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
  }
}
