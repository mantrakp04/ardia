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

@MainActor
@Observable
final class ToastAppearance {
  var interfaceStyle = InterfaceStyle.glass
  var glassTintAmount = GlassTint.defaultAmount
  var look = ProfileLook.plum
  var colorScheme = ColorScheme.light

  func update(from environment: EnvironmentValues) {
    if interfaceStyle != environment.interfaceStyle { interfaceStyle = environment.interfaceStyle }
    if glassTintAmount != environment.glassTintAmount { glassTintAmount = environment.glassTintAmount }
    if look != environment.profileLook { look = environment.profileLook }
    if colorScheme != environment.colorScheme { colorScheme = environment.colorScheme }
  }
}

private struct ToastOverlayRoot: View {
  let center: ToastCenter
  let window: ToastPassthroughWindow
  let appearance: ToastAppearance

  var body: some View {
    Color.clear
      .ignoresSafeArea()
      .allowsHitTesting(false)
      .toastOverlay(center) {
        window.isSheetPresented ? ToastOverlay.sheetClearance : ToastOverlay.barClearance
      } onInteractiveFrame: { frame in
        window.interactiveFrame = frame
      }
      .environment(\.interfaceStyle, appearance.interfaceStyle)
      .environment(\.glassTintAmount, appearance.glassTintAmount)
      .environment(\.profileLook, appearance.look)
      .environment(\.colorScheme, appearance.colorScheme)
      .onChange(of: appearance.colorScheme, initial: true) { _, scheme in
        window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
      }
  }
}

@MainActor
private enum ToastWindowRegistry {
  static var windows: [ObjectIdentifier: ToastPassthroughWindow] = [:]

  static func install(in scene: UIWindowScene, center: ToastCenter, appearance: ToastAppearance) {
    let key = ObjectIdentifier(scene)
    guard windows[key] == nil else { return }
    let window = ToastPassthroughWindow(windowScene: scene)
    window.windowLevel = .alert + 1
    window.backgroundColor = .clear
    let host = UIHostingController(rootView: ToastOverlayRoot(center: center, window: window, appearance: appearance))
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

  func updateUIView(_ uiView: InstallerView, context: Context) {
    uiView.appearance.update(from: context.environment)
  }

  final class InstallerView: UIView {
    let toasts: ToastCenter
    let appearance = ToastAppearance()

    init(center: ToastCenter) {
      toasts = center
      super.init(frame: .zero)
      isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { nil }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      guard let scene = window?.windowScene else { return }
      ToastWindowRegistry.install(in: scene, center: toasts, appearance: appearance)
    }
  }
}

extension View {
  func toastWindow(_ center: ToastCenter) -> some View {
    background(ToastWindowInstaller(center: center).frame(width: 0, height: 0).accessibilityHidden(true))
  }
}
