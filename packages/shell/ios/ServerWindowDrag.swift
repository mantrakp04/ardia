import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

enum ServerWindowDrag {
  private static let regions = NSHashTable<NSView>.weakObjects()
  private static let opaqueRectSelector = NSSelectorFromString("_opaqueRectForWindowMoveWhenInTitlebar")
  private static let refreshSelector = NSSelectorFromString("_updateDragRegionForHiddenStateChange")
  private static let enabled = LaunchConfig.shared.experimentOn("serverWindowDrag") || allOpen
  private static let allOpen = LaunchConfig.shared.experimentOn("serverWindowDragAllOpen")

  private static let refreshEvery: CFTimeInterval = 0.1
  private static var targets: [ObjectIdentifier: (blocking: [ObjectIdentifier: Bool], open: [NSRect])] = [:]
  private static var refreshedAt: [ObjectIdentifier: CFTimeInterval] = [:]
  private static let watchers = NSMapTable<NSWindow, PointerWatcher>.weakToStrongObjects()

  private static let lastWindow = NSMapTable<NSView, NSWindow>.weakToWeakObjects()

  static func track(_ region: NSView, bridge: AnyObject? = nil) {
    guard enabled, capable else { return }
    if let bridge { observeMounting(bridge) }
    if let old = lastWindow.object(forKey: region), old !== region.window { refresh(old) }
    if let window = region.window {
      regions.add(region)
      lastWindow.setObject(window, forKey: region)
      watch(window)
      refresh(window)
    } else {
      regions.remove(region)
      lastWindow.removeObject(forKey: region)
    }
  }

  static func refresh(_ view: NSView) {
    if let window = view.window { refresh(window) }
  }

  static func refresh(_ window: NSWindow) {
    guard enabled, capable, let content = window.contentView else { return }
    targets[ObjectIdentifier(window)] = nil
    refreshedAt[ObjectIdentifier(window)] = CACurrentMediaTime()
    content.perform(refreshSelector)
  }

  private static func watch(_ window: NSWindow) {
    guard watchers.object(forKey: window) == nil, let frame = window.contentView?.superview else { return }
    watchers.setObject(PointerWatcher(frame), forKey: window)
    let key = ObjectIdentifier(window)
    var closing: NSObjectProtocol?
    closing = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { _ in
      targets[key] = nil
      refreshedAt[key] = nil
      pending[key]?.cancel()
      pending[key] = nil
      if let closing { NotificationCenter.default.removeObserver(closing) }
    }
  }

  static func pointerMoved(in window: NSWindow, at point: NSPoint) {
    guard point.y >= window.frame.height - band(window) else { return }
    scheduleRefresh(window)
    let now = CACurrentMediaTime()
    if let last = refreshedAt[ObjectIdentifier(window)], now - last < refreshEvery { return }
    refresh(window)
  }

  private static var pending: [ObjectIdentifier: DispatchWorkItem] = [:]

  static func scheduleRefresh(_ window: NSWindow) {
    let key = ObjectIdentifier(window)
    pending[key]?.cancel()
    let work = DispatchWorkItem { [weak window] in
      pending[key] = nil
      if let window { refresh(window) }
    }
    pending[key] = work
    DispatchQueue.main.asyncAfter(deadline: .now() + refreshEvery, execute: work)
  }

  static func scheduleRefreshAll() {
    var seen = Set<ObjectIdentifier>()
    for region in regions.allObjects {
      guard let window = region.window, seen.insert(ObjectIdentifier(window)).inserted else { continue }
      scheduleRefresh(window)
    }
  }

  private static var mounting: MountWatcher?
  private static var eventMonitor: Any?

  private static func observeMounting(_ bridge: AnyObject) {
    guard mounting == nil,
          let manager = bridge.value(forKey: "uiManager") as AnyObject?,
          let coordinator = manager.value(forKey: "observerCoordinator") as AnyObject?
    else { return }
    let watcher = MountWatcher()
    let add = NSSelectorFromString("addObserver:")
    guard coordinator.responds(to: add) else { return }
    _ = coordinator.perform(add, with: watcher)
    mounting = watcher
    eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp, .otherMouseUp, .keyUp, .flagsChanged]) { event in
      if let window = event.window { scheduleRefresh(window) }
      return event
    }
  }

  static func band(_ window: NSWindow) -> CGFloat {
    max(0, window.frame.height - window.contentLayoutRect.height)
  }

  private static func openRects(_ window: NSWindow) -> [NSRect] {
    let height = window.frame.height
    let strip = NSRect(x: 0, y: height - band(window), width: window.frame.width, height: band(window))
    return regions.allObjects.filter { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }
      .map { windowRect($0).intersection(strip) }
      .filter { !$0.isEmpty }
  }

  private static func topLayer(_ window: NSWindow?) -> CALayer? { window?.contentView?.superview?.layer }

  static func windowRect(_ view: NSView) -> NSRect {
    if let layer = view.layer, let top = topLayer(view.window) { return layer.convert(layer.bounds, to: top) }
    return view.convert(view.bounds, to: nil)
  }

  private static func transformed(_ view: NSView) -> Bool {
    guard let layer = view.layer else { return false }
    return !CATransform3DIsIdentity(layer.transform) || !layer.affineTransform().isIdentity
  }

  private static func zOrdered(_ view: NSView) -> [NSView] {
    let sorted = NSSelectorFromString("reactZIndexSortedSubviews")
    if view.responds(to: sorted), let subviews = view.perform(sorted)?.takeUnretainedValue() as? [NSView] { return subviews }
    return view.subviews
  }

  private enum Layer { case region, beneath, above, inert }

  private static func classify(_ window: NSWindow) -> (blocking: [ObjectIdentifier: Bool], open: [NSRect]) {
    let key = ObjectIdentifier(window)
    if let cached = targets[key] { return cached }
    let open = openRects(window)
    var blocking: [ObjectIdentifier: Bool] = [:]
    let rn: AnyClass? = NSClassFromString("RCTView")
    func pointerEvents(_ view: NSView) -> Int {
      guard let rn, view.isKind(of: rn) else { return 0 }
      return (view.value(forKey: "pointerEvents") as? NSNumber)?.intValue ?? 0
    }
    var moving = false
    func visit(_ view: NSView, _ layer: Layer) {
      let frame = windowRect(view)
      guard !moving, !view.isHidden, open.contains(where: { $0.intersects(frame) }) else { return }
      if transformed(view) {
        moving = true
        return
      }
      var children = layer
      switch leadsToRegion(view) ? .region : layer {
      case .region:
        blocking[ObjectIdentifier(view)] = false
        var passed = false
        for child in zOrdered(view) {
          if leadsToRegion(child) {
            passed = true
            visit(child, .region)
          } else {
            visit(child, passed ? .above : .beneath)
          }
        }
        return
      case .beneath, .inert:
        blocking[ObjectIdentifier(view)] = false
      case .above:
        if pointerEvents(view) == 1 {
          blocking[ObjectIdentifier(view)] = false
          children = .inert
        } else if takesPresses(view, in: frame, open) {
          blocking[ObjectIdentifier(view)] = view.alphaValue > 0
          return
        } else {
          blocking[ObjectIdentifier(view)] = false
        }
      }
      for child in zOrdered(view) { visit(child, children) }
    }
    if let root = embeddedRoot(window), leadsToRegion(root) { visit(root, .region) }
    if moving {
      targets[key] = ([:], [])
      return ([:], [])
    }
    targets[key] = (blocking, open)
    return (blocking, open)
  }

  private static func takesPresses(_ view: NSView, in frame: NSRect, _ open: [NSRect]) -> Bool {
    guard let parent = view.superview else { return true }
    for rect in open {
      let area = rect.intersection(frame)
      if area.isEmpty { continue }
      for i in 0..<5 {
        for j in 0..<3 {
          let point = NSPoint(x: area.minX + area.width * (CGFloat(i) + 0.5) / 5, y: area.minY + area.height * (CGFloat(j) + 0.5) / 3)
          let local = parent.layer.flatMap { layer in topLayer(view.window).map { layer.convert(point, from: $0) } } ?? parent.convert(point, from: nil)
          if view.hitTest(local) === view { return true }
        }
      }
    }
    return false
  }

  static func blocks(_ view: NSView) -> Bool {
    guard let window = view.window else { return true }
    return classify(window).blocking[ObjectIdentifier(view)] ?? true
  }

  static func leadsToRegion(_ view: NSView) -> Bool {
    regions.allObjects.contains { $0 === view || $0.isDescendant(of: view) }
  }

  static func embeddedRoot(_ window: NSWindow?) -> NSView? {
    window.flatMap { ArdiaChromeWindowHost.embeddedRoot(of: $0) }
  }

  static func hostsRoot(_ view: NSView) -> Bool {
    embeddedRoot(view.window) != nil && view === view.window?.contentView
  }

  static func inRoot(_ view: NSView) -> Bool {
    guard let root = embeddedRoot(view.window) else { return false }
    return view === root || view.isDescendant(of: root)
  }

  private typealias BlockingRegion = @convention(c) (AnyObject, Selector, NSRect) -> OpaquePointer?
  private typealias EnumerateRegion = @convention(c) (OpaquePointer) -> OpaquePointer?
  private typealias NextRect = @convention(c) (OpaquePointer) -> UnsafePointer<CGRect>?
  private typealias ReleaseRegion = @convention(c) (OpaquePointer) -> Int32
  private static let blockingRegionSelector = NSSelectorFromString("_regionForOpaqueViewsBlockingDraggableFrame:")

  private static let skyLight: (enumerate: EnumerateRegion, next: NextRect, release: ReleaseRegion)? = {
    guard let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW),
          let enumerate = dlsym(sky, "CGSRegionEnumerator"), let next = dlsym(sky, "CGSNextRect"),
          let release = dlsym(sky, "CGSReleaseRegionEnumerator")
    else { return nil }
    return (unsafeBitCast(enumerate, to: EnumerateRegion.self), unsafeBitCast(next, to: NextRect.self), unsafeBitCast(release, to: ReleaseRegion.self))
  }()

  private static func blockingRects(_ window: NSWindow, in rect: NSRect) -> [NSRect]? {
    guard let sky = skyLight, let method = class_getInstanceMethod(type(of: window), blockingRegionSelector),
          method_getNumberOfArguments(method) == 3, let types = method_getTypeEncoding(method), String(cString: types).hasPrefix("^")
    else { return nil }
    guard let region = unsafeBitCast(method_getImplementation(method), to: BlockingRegion.self)(window, blockingRegionSelector, rect),
          let rects = sky.enumerate(region)
    else { return nil }
    defer { _ = sky.release(rects) }
    var out: [NSRect] = []
    while let r = sky.next(rects) { out.append(r.pointee) }
    return out
  }

  static func serverOwnsPress(_ window: NSWindow, at point: NSPoint) -> Bool {
    guard let frame = window.contentView?.superview else { return false }
    let titlebar = NSRect(x: 0, y: frame.bounds.height - band(window), width: frame.bounds.width, height: band(window))
    guard titlebar.contains(point), let blocking = blockingRects(window, in: frame.bounds) else { return false }
    return !blocking.contains { $0.contains(point) }
  }

  #if DEBUG
  static func blockedRects(_ window: NSWindow) -> [[Double]] {
    targets[ObjectIdentifier(window)] = nil
    guard let frame = window.contentView?.superview, let rects = blockingRects(window, in: frame.bounds) else { return [] }
    return rects.map { [$0.minX, frame.bounds.height - $0.maxY, $0.width, $0.height] }
  }
  #endif

  private typealias OpaqueRect = @convention(c) (AnyObject, Selector) -> NSRect

  private typealias CanMove = @convention(c) (AnyObject, Selector) -> Bool
  private static let canMoveSelector = #selector(getter: NSView.mouseDownCanMoveWindow)

  private static func matches(_ cls: AnyClass, _ selector: Selector, _ encoding: (String) -> Bool) -> Bool {
    guard let method = class_getInstanceMethod(cls, selector), let types = method_getTypeEncoding(method) else { return false }
    return encoding(String(cString: types))
  }

  private static let capable: Bool = {
    let noArguments = { (types: String) in types.hasSuffix("@0:8") }
    let host: AnyClass = ArdiaChromeWindowHost.contentViewClass
    guard NSClassFromString("RCTView") != nil,
          matches(NSView.self, opaqueRectSelector, { $0.hasPrefix("{CGRect=") && noArguments($0) }),
          matches(host, opaqueRectSelector, { $0.hasPrefix("{CGRect=") && noArguments($0) }),
          matches(NSView.self, refreshSelector, { $0.hasPrefix("v") && noArguments($0) }),
          matches(NSView.self, canMoveSelector, { ($0.hasPrefix("B") || $0.hasPrefix("c")) && noArguments($0) })
    else { return false }
    install(host)
    return true
  }()

  private static func install(_ host: AnyClass) {
    replaceRect(host) { view, original in hostsRoot(view) ? .zero : original() }
    replaceCanMove(host) { view, original in hostsRoot(view) ? true : original() }
    replaceRect(NSView.self) { view, original in
      guard inRoot(view) else { return original() }
      return !allOpen && blocks(view) ? view.bounds : .zero
    }
    for name in ["NSView", "RCTUIView", "RCTView"] {
      guard let cls = NSClassFromString(name) else { continue }
      replaceCanMove(cls) { view, original in
        if inRoot(view) { return allOpen || !blocks(view) ? true : original() }
        return hostsRoot(view) ? true : original()
      }
    }
  }

  private static func replaceRect(_ cls: AnyClass, _ body: @escaping (NSView, () -> NSRect) -> NSRect) {
    guard let method = class_getInstanceMethod(cls, opaqueRectSelector) else { return }
    let original = unsafeBitCast(method_getImplementation(method), to: OpaqueRect.self)
    let block: @convention(block) (NSView) -> NSRect = { view in body(view) { original(view, opaqueRectSelector) } }
    let imp = imp_implementationWithBlock(block)
    if !class_addMethod(cls, opaqueRectSelector, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
  }

  private static func replaceCanMove(_ cls: AnyClass, _ body: @escaping (NSView, () -> Bool) -> Bool) {
    guard let method = class_getInstanceMethod(cls, canMoveSelector) else { return }
    let original = unsafeBitCast(method_getImplementation(method), to: CanMove.self)
    let block: @convention(block) (NSView) -> Bool = { view in body(view) { original(view, canMoveSelector) } }
    let imp = imp_implementationWithBlock(block)
    if !class_addMethod(cls, canMoveSelector, imp, method_getTypeEncoding(method)) { method_setImplementation(method, imp) }
  }
}
