import AppKit

@objc(ArdiaDockTilePlugIn)
final class ArdiaDockTilePlugIn: NSObject, NSDockTilePlugIn {
  private var dockTile: NSDockTile?
  private var observer: NSObjectProtocol?
  private var styleWatcher: IconStyleWatcher?
  private var saved = "default"

  private lazy var app: Bundle? = {
    let url = Bundle(for: ArdiaDockTilePlugIn.self).bundleURL
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    return Bundle(url: url)
  }()

  private var cacheKey: String { "\(app?.bundleIdentifier ?? "app").\(AppIcons.defaultsKey)" }

  func setDockTile(_ dockTile: NSDockTile?) {
    if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
    observer = nil
    styleWatcher = nil
    self.dockTile = dockTile
    guard dockTile != nil, let app, let bundleId = app.bundleIdentifier else { return }

    if let artwork = app.image(forResource: "AppIcon") { AppIcons.base = artwork }
    AppIcons.markNamed = { [app] in app.image(forResource: $0) }
    observer = DistributedNotificationCenter.default().addObserver(
      forName: AppIcons.changedNotification(bundleId: bundleId), object: nil, queue: .main
    ) { [weak self] note in
      guard let self, let id = note.userInfo?["icon"] as? String else { return }
      UserDefaults.standard.set(id, forKey: self.cacheKey)
      self.saved = id
      self.show()
    }
    let stored = CFPreferencesCopyAppValue(AppIcons.defaultsKey as CFString, bundleId as CFString) as? String
    saved = stored ?? UserDefaults.standard.string(forKey: cacheKey) ?? "default"
    styleWatcher = IconStyleWatcher { [weak self] in self?.show() }
    show()
  }

  private func show() {
    guard let dockTile else { return }
    let id = IconStyle.shown(saved: saved, theme: IconStyle.systemTheme)
    if id == "default" || !AppIcons.variants.contains(where: { $0.id == id }) {
      dockTile.contentView = nil
    } else if let image = AppIcons.image(id, size: 512) {
      let view = NSImageView(frame: NSRect(origin: .zero, size: dockTile.size))
      view.image = image
      view.imageScaling = .scaleProportionallyUpOrDown
      dockTile.contentView = view
    }
    dockTile.display()
  }

  deinit {
    if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
  }
}
