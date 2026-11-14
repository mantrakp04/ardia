import ArdiaDesign
import OSLog
import SwiftUI
import UIKit

struct ChromeEnvironment: ViewModifier {
  let launch: DemoLaunch
  @State private var window: WindowMetrics
  @State private var deviceHinge: HingeState?

  init(launch: DemoLaunch) {
    self.launch = launch
    _window = State(initialValue: WindowMetrics(size: launch.canvas ?? Self.sceneSize, cornerRadii: RectangleCornerRadii(uniform: 0)))
  }

  func body(content: Content) -> some View {
    let hinge = launch.hinge ?? deviceHinge
    content
      .environment(\.chromeLayout, window.layout)
      .environment(\.hingeState, hinge)
      .environment(\.windowCornerRadii, window.cornerRadii)
      .background {
        WindowProbe(window: $window, hinge: $deviceHinge, canvas: launch.canvas)
      }
      .onChange(of: window, initial: true) { _, metrics in ChromeLog.window(metrics) }
      .onChange(of: hinge, initial: true) { _, state in ChromeLog.hinge(state) }
  }

  private static var sceneSize: CGSize {
    UIApplication.shared.connectedScenes.lazy.compactMap { $0 as? UIWindowScene }.first?.effectiveGeometry.coordinateSpace.bounds.size ?? .zero
  }
}

extension View {
  func chromeEnvironment(_ launch: DemoLaunch) -> some View {
    modifier(ChromeEnvironment(launch: launch))
  }
}

private struct WindowProbe: View {
  @Binding var window: WindowMetrics
  @Binding var hinge: HingeState?
  let canvas: CGSize?

  var body: some View {
    Color.clear
      .onGeometryChange(for: WindowMetrics.self) { proxy in
        WindowMetrics(proxy)
      } action: { metrics in
        window = metrics
      }
      .ignoresSafeArea()
      .onHingeStateChange { hinge = $0 }
      .background {
        if let canvas { CanvasWindowFramer(size: canvas) }
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

private enum ChromeLog {
  static let log = Logger(subsystem: "com.ardia.browser.ios", category: "chrome")

  static func window(_ metrics: WindowMetrics) {
    let size = "\(Int(metrics.size.width))x\(Int(metrics.size.height))"
    let corners = metrics.cornerRadii
    log.notice("layout \(metrics.layout.rawValue, privacy: .public) window \(size, privacy: .public) corners \(corners.topLeading, privacy: .public) \(corners.topTrailing, privacy: .public) \(corners.bottomTrailing, privacy: .public) \(corners.bottomLeading, privacy: .public)")
  }

  static func hinge(_ state: HingeState?) {
    log.notice("hinge \(state?.rawValue ?? "none", privacy: .public)")
  }
}
