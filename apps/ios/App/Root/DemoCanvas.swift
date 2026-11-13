import SwiftUI
import UIKit

struct CanvasWindowFramer: UIViewRepresentable {
  let size: CGSize

  func makeUIView(context: Context) -> FramerView {
    FramerView(canvas: size)
  }

  func updateUIView(_ uiView: FramerView, context: Context) {}

  final class FramerView: UIView {
    private static let systemWindowMarkers = ["Keyboard", "TextEffects"]

    let canvas: CGSize
    private var appearance: NSObjectProtocol?

    init(canvas: CGSize) {
      self.canvas = canvas
      super.init(frame: .zero)
      isUserInteractionEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    isolated deinit {
      appearance.map(NotificationCenter.default.removeObserver)
    }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      frameWindows()
      guard appearance == nil, window != nil else { return }
      appearance = NotificationCenter.default.addObserver(forName: UIWindow.didBecomeVisibleNotification, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.frameWindows() }
      }
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      frameWindows()
    }

    private func frameWindows() {
      guard let scene = window?.windowScene else { return }
      let bounds = scene.effectiveGeometry.coordinateSpace.bounds
      let frame = CGRect(
        x: ((bounds.width - canvas.width) / 2).rounded(),
        y: ((bounds.height - canvas.height) / 2).rounded(),
        width: canvas.width,
        height: canvas.height
      )
      for window in scene.windows where window.frame != frame && Self.isAppWindow(window) {
        window.frame = frame
      }
    }

    private static func isAppWindow(_ window: UIWindow) -> Bool {
      let name = NSStringFromClass(type(of: window))
      return !systemWindowMarkers.contains { name.contains($0) }
    }
  }
}
