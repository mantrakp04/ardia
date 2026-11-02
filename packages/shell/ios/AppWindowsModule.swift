import AppKit
import ExpoModulesCore

public class AppWindowsModule: Module {
  private let lifetime = ModuleLifetime()

  public func definition() -> ModuleDefinition {
    Name("ArdiaAppWindows")
    Events(ShellEvents.Channel.window.rawValue)

    OnCreate {
      self.lifetime.begin(self) {
        DragPreview.shared.cancel()
        LeftEdgeWatcher.shared.reset()
        ShellEvents.retire(self)
      }
      ShellEvents.attach(.window, to: self, while: self.lifetime)
    }

    OnDestroy {
      ShellEvents.detach(self) { owned in
        guard owned.contains(.window) else { return }
        WindowManager.shared.runtimeGone()
        LeftEdgeWatcher.shared.reset()
      }
      self.lifetime.end()
    }

    AsyncFunction("openWindow") { (id: String, options: OpenWindowOptions) in
      WindowManager.shared.open(id: id, options, focus: options.focus)
    }.runOnQueue(.main)
    AsyncFunction("closeWindow") { (id: String) in WindowManager.shared.close(id: id) }.runOnQueue(.main)
    AsyncFunction("animateWindowClose") { (id: String, after: String?, promise: Promise) in
      WindowManager.shared.animateClose(id: id, after: after) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("setTrafficLightsCenter") { (id: String, center: CGPoint?) in
      WindowManager.shared.setTrafficLightsCenter(id: id, center: center)
    }.runOnQueue(.main)
    AsyncFunction("watchLeftEdge") { (id: String, on: Bool, hold: Double) in
      LeftEdgeWatcher.shared.watch(id: id, on: on, hold: CGFloat(hold))
    }.runOnQueue(.main)
    AsyncFunction("focusWindow") { (id: String) in WindowManager.shared.focus(id: id) }.runOnQueue(.main)
    AsyncFunction("restoreFullScreen") { (ids: [String], focus: String?) in
      WindowManager.shared.fullScreen.restore(ids: ids, focus: focus)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewBegin") { (windowId: String, chip: CGRect, grab: CGPoint) in
      DragPreview.shared.begin(windowId: windowId, chip: chip, grab: grab)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPage") { (base64: String, frame: CGRect) in
      guard let data = Data(base64Encoded: base64) else { return }
      DragPreview.shared.setPage(data, frame: frame)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewUpdate") { (shape: String, point: CGPoint) in
      DragPreview.shared.update(shape: shape, at: point)
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewCancel") { DragPreview.shared.cancel() }.runOnQueue(.main)
    AsyncFunction("raiseView") { (tag: Int, levels: Int, raised: Bool) in
      guard var view = self.appContext?.findView(withTag: tag, ofType: NSView.self) else { return }
      for _ in 0...max(0, levels) {
        guard let parent = view.superview else { return }
        let layers = view.layer.flatMap { layer in parent.layer.flatMap { $0 === layer.superlayer ? (layer, $0) : nil } }
        if raised {
          if parent.subviews.last !== view { parent.addSubview(view, positioned: .above, relativeTo: nil) }
          if let (layer, host) = layers, host.sublayers?.last !== layer { host.addSublayer(layer) }
        } else if let order = parent.value(forKey: "reactSubviews") as? [NSView], let index = order.firstIndex(where: { $0 === view }) {
          if let next = order[(index + 1)...].first(where: { $0.superview === parent }) {
            parent.addSubview(view, positioned: .below, relativeTo: next)
            if let (layer, host) = layers, let below = next.layer, below.superlayer === host { host.insertSublayer(layer, below: below) }
          } else if parent.subviews.last !== view {
            parent.addSubview(view, positioned: .above, relativeTo: nil)
            if let (layer, host) = layers { host.addSublayer(layer) }
          }
        }
        view = parent
      }
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewPlaceholder") { (title: String, favicon: String?) in
      DragPreview.shared.setPlaceholder(title: title, favicon: favicon)
    }.runOnQueue(.main)
    AsyncFunction("windowFrame") { (id: String) -> [Double]? in
      guard let f = WindowManager.shared.window(id)?.frame else { return nil }
      return [f.minX, f.minY, f.width, f.height]
    }.runOnQueue(.main)
    AsyncFunction("dragPreviewEnd") { (windowId: String?, frame: CGRect?) in
      DragPreview.shared.end(windowId: windowId, fallback: frame)
    }.runOnQueue(.main)
    AsyncFunction("setWindowTitle") { (id: String, title: String) in
      WindowManager.shared.setTitle(id: id, title: title)
    }.runOnQueue(.main)
    AsyncFunction("windowIds") { () -> [String] in WindowManager.shared.windowIds }.runOnQueue(.main)
    AsyncFunction("replyToTerminate") { (ok: Bool) in QuitFlow.shared.replyToTerminate(ok) }.runOnQueue(.main)

    View(WindowDragRegion.self) {
      Events("onRegionDoubleClick", "onRegionClick")
      Prop("titleBarDoubleClick") { (view: WindowDragRegion, on: Bool) in view.titleBarDoubleClick = on }
      Prop("clickable") { (view: WindowDragRegion, on: Bool) in view.clickable = on }
    }
  }
}
