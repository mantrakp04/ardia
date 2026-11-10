import ArdiaDesign
import SwiftUI
import UIKit

final class ToastPassthroughWindow: UIWindow {
  var interactiveFrame: CGRect = .null

  var isSheetPresented: Bool {
    let content = windowScene?.windows.first { $0 !== self && $0.isKeyWindow }
    return content?.rootViewController?.presentedViewController != nil
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard interactiveFrame.insetBy(dx: -8, dy: -8).contains(point) else { return nil }
    return super.hitTest(point, with: event)
  }
}

private struct ToastOverlayRoot: View {
  let center: ToastCenter
  let window: ToastPassthroughWindow

  var body: some View {
    Color.clear
      .ignoresSafeArea()
      .allowsHitTesting(false)
      .toastOverlay(center) {
        window.isSheetPresented ? ToastOverlay.sheetClearance : ToastOverlay.barClearance
      } onInteractiveFrame: { frame in
        window.interactiveFrame = frame
      }
  }
}

@MainActor
private enum ToastWindowRegistry {
  static var windows: [ObjectIdentifier: ToastPassthroughWindow] = [:]

  static func install(in scene: UIWindowScene, center: ToastCenter) {
    let key = ObjectIdentifier(scene)
    guard windows[key] == nil else { return }
    let window = ToastPassthroughWindow(windowScene: scene)
    window.windowLevel = .alert + 1
    window.backgroundColor = .clear
    let host = UIHostingController(rootView: ToastOverlayRoot(center: center, window: window))
    host.view.backgroundColor = .clear
    window.rootViewController = host
    window.isHidden = false
    windows[key] = window
  }
}

private struct ToastWindowInstaller: UIViewRepresentable {
  let center: ToastCenter

  func makeUIView(context: Context) -> InstallerView {
    InstallerView(center: center)
  }

  func updateUIView(_ uiView: InstallerView, context: Context) {}

  final class InstallerView: UIView {
    let toasts: ToastCenter

    init(center: ToastCenter) {
      toasts = center
      super.init(frame: .zero)
      isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { nil }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      guard let scene = window?.windowScene else { return }
      ToastWindowRegistry.install(in: scene, center: toasts)
    }
  }
}

extension View {
  func toastWindow(_ center: ToastCenter) -> some View {
    background(ToastWindowInstaller(center: center).frame(width: 0, height: 0).accessibilityHidden(true))
  }
}
