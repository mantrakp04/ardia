import ArdiaDesign
import SwiftUI

struct ToastView: View {
  let toast: Toast

  var body: some View {
    HStack(spacing: Tokens.Space.m) {
      Image(systemName: toast.symbol)
        .font(Typography.row.weight(Tokens.Weight.semibold))
        .symbolRenderingMode(.hierarchical)
        .accessibilityHidden(true)
      Text(toast.message)
        .font(Typography.row.weight(Tokens.Weight.semibold))
        .multilineTextAlignment(.leading)
        .lineLimit(3)
    }
    .foregroundStyle(Tokens.Role.textPrimary)
    .padding(.horizontal, Tokens.Space.xl)
    .padding(.vertical, Tokens.Space.ml)
    .frame(minHeight: GlassMetrics.hitTarget)
    .glassPanel(.capsule)
    .contentShape(Capsule())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(toast.onTap == nil ? .isStaticText : .isButton)
  }
}

struct ToastOverlay: ViewModifier {
  static let barClearance = BarMetrics.toastClearance
  static let sheetClearance = Tokens.Space.l

  let center: ToastCenter
  var clearance: () -> CGFloat = { ToastOverlay.barClearance }
  var onInteractiveFrame: (CGRect) -> Void = { _ in }
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var dragOffset: CGFloat = 0

  func body(content: Content) -> some View {
    content
      .overlay(alignment: center.isKeyboardVisible ? .top : .bottom) {
        ZStack {
          if let toast = center.current {
            ToastView(toast: toast)
              .padding(.horizontal, Tokens.Space.huge)
              .padding(.bottom, center.isKeyboardVisible ? 0 : clearance())
              .padding(.top, center.isKeyboardVisible ? Tokens.Space.xs : 0)
              .offset(y: max(dragOffset, dragOffset / 4))
              .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { onInteractiveFrame($0) }
              .onDisappear { onInteractiveFrame(.null) }
              .gesture(dismissDrag)
              .onTapGesture { center.activate() }
              .transition(transition)
              .id(toast.id)
          }
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : Motion.snappy, value: center.current?.id)
      }
  }

  private var transition: AnyTransition {
    reduceMotion
      ? .opacity
      : .asymmetric(
          insertion: .offset(y: 24).combined(with: .opacity).combined(with: .scale(scale: 0.92, anchor: .bottom)),
          removal: .offset(y: 16).combined(with: .opacity)
        )
  }

  private var dismissDrag: some Gesture {
    DragGesture(minimumDistance: 6)
      .onChanged { value in
        center.hold(true)
        dragOffset = value.translation.height
      }
      .onEnded { value in
        let flungDown = value.predictedEndTranslation.height > 40 || value.translation.height > 24
        if flungDown {
          center.dismiss()
          dragOffset = 0
        } else {
          withAnimation(Motion.snappy) { dragOffset = 0 }
          center.hold(false)
        }
      }
  }
}

extension View {
  func toastOverlay(
    _ center: ToastCenter,
    clearance: @escaping () -> CGFloat = { ToastOverlay.barClearance },
    onInteractiveFrame: @escaping (CGRect) -> Void = { _ in }
  ) -> some View {
    modifier(ToastOverlay(center: center, clearance: clearance, onInteractiveFrame: onInteractiveFrame))
  }

  func toastHost(_ center: ToastCenter) -> some View {
    toastWindow(center)
      .modifier(ReceivedTabsAnnouncer(center: center))
  }
}

#Preview("Toasts") {
  @Previewable @State var center = ToastCenter()
  VStack(spacing: Tokens.Space.l) {
    Button("Copied URL") { center.show(.copiedURL) }
    Button("Cleared Browsing Data") { center.show(.clearedBrowsingData) }
    Button("Tab From Mac") { center.show(.tabReceived(from: "Luke's MacBook Pro")) }
  }
  .buttonStyle(.bordered)
  .frame(maxWidth: .infinity, maxHeight: .infinity)
  .toastOverlay(center)
}

#Preview("Toast Styles") {
  VStack(spacing: Tokens.Space.l) {
    ToastView(toast: .copiedURL)
    ToastView(toast: .clearedBrowsingData)
    ToastView(toast: .tabReceived(from: "Luke's MacBook Pro"))
  }
  .padding()
}
