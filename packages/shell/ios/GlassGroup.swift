import AppKit
import ExpoModulesCore

final class GlassGroup: ExpoView {
  private let container: NSView?
  private let glassLayer = GlassGroupContent()
  private let content = GlassGroupContent()
  private let members = NSHashTable<GlassEffect>.weakObjects()
  var strength: Double = 1 { didSet { container?.alphaValue = strength } }

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *), LiquidGlass.groupsGlass {
      let group = NSGlassEffectContainerView()
      group.contentView = glassLayer
      container = group
    } else {
      container = nil
    }
    super.init(appContext: appContext)
    if let container {
      addSubview(container)
      addSubview(content)
      GlassGroupMounts.observe(appContext?.reactBridge?.uiManager)
    }
  }

  var hostsGlass: Bool { container != nil }

  func adopt(_ member: GlassEffect, glass: NSView) {
    members.add(member)
    if glass.superview !== glassLayer { glassLayer.addSubview(glass) }
    place(member)
  }

  func release(_ member: GlassEffect, glass: NSView) {
    members.remove(member)
    if glass.superview === glassLayer { glass.removeFromSuperview() }
  }

  func place(_ member: GlassEffect) {
    guard let glass = member.hostedGlass, glass.superview === glassLayer else { return }
    let frame = member.convert(member.bounds, to: content)
    if glass.frame != frame { glass.frame = frame }
    let hidden = !shows(member)
    if glass.isHidden != hidden { glass.isHidden = hidden }
  }

  func placeAll() {
    for member in members.allObjects { place(member) }
  }

  private func shows(_ member: NSView) -> Bool {
    var view: NSView? = member
    while let shown = view, shown !== content {
      if shown.isHidden || shown.alphaValue < 0.01 { return false }
      view = shown.superview
    }
    return view === content
  }

  override func didUpdateReactSubviews() {
    guard container != nil else { return super.didUpdateReactSubviews() }
    let wanted: [NSView] = reactSubviews() ?? []
    if content.subviews != wanted { content.subviews = wanted }
    placeAll()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { GlassGroupMounts.groups.remove(self) } else if container != nil { GlassGroupMounts.groups.add(self) }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    container?.frame = bounds
    glassLayer.frame = bounds
    content.frame = bounds
    placeAll()
  }
}

private final class GlassGroupContent: NSView {
  override var isFlipped: Bool { true }
}

enum GlassGroupMounts {
  static let groups = NSHashTable<GlassGroup>.weakObjects()
  private static var watcher: GlassGroupMountWatcher?

  static func observe(_ manager: AnyObject?) {
    guard watcher == nil, let manager,
          let coordinator = manager.value(forKey: "observerCoordinator") as AnyObject?
    else { return }
    let add = NSSelectorFromString("addObserver:")
    guard coordinator.responds(to: add) else { return }
    let next = GlassGroupMountWatcher()
    _ = coordinator.perform(add, with: next)
    watcher = next
  }

  static func placeAll() {
    for group in groups.allObjects { group.placeAll() }
  }
}

final class GlassGroupMountWatcher: NSObject {
  private typealias UIBlock = @convention(block) (AnyObject?, AnyObject?) -> Void
  private static let addUIBlock = NSSelectorFromString("addUIBlock:")
  private static let placeAll: UIBlock = { _, _ in GlassGroupMounts.placeAll() }

  @objc func uiManagerWillPerformMounting(_ manager: AnyObject) {
    guard manager.responds(to: Self.addUIBlock) else { return }
    _ = manager.perform(Self.addUIBlock, with: unsafeBitCast(Self.placeAll, to: AnyObject.self))
  }
}
