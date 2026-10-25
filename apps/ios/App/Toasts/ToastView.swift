import ArdiaDesign
import SwiftUI

struct ToastView: View {
  let toast: Toast

  var body: some View {
    HStack(spacing: Spacing.tight) {
      Image(systemName: toast.symbol)
        .font(.subheadline.weight(.semibold))
        .symbolRenderingMode(.hierarchical)
        .accessibilityHidden(true)
      Text(toast.message)
        .font(.subheadline.weight(.semibold))
        .multilineTextAlignment(.leading)
        .lineLimit(3)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, 11)
    .frame(minHeight: 44)
    .background {
      Capsule(style: .continuous)
        .fill(Palette.toast.gradient)
        .overlay {
          Capsule(style: .continuous)
            .strokeBorder(.white.opacity(0.14), lineWidth: 0.5)
        }
        .shadow(color: Palette.toastShadow.opacity(0.32), radius: 14, y: 6)
    }
    .contentShape(Capsule())
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(toast.onTap == nil ? .isStaticText : .isButton)
  }
}

struct ToastOverlay: ViewModifier {
  static let barClearance: CGFloat = 64
  static let sheetClearance: CGFloat = 12

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
              .padding(.horizontal, Spacing.page * 2)
              .padding(.bottom, center.isKeyboardVisible ? 0 : clearance())
              .padding(.top, center.isKeyboardVisible ? 4 : 0)
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
  VStack(spacing: Spacing.small) {
    Button("Copied URL") { center.show(.copiedURL) }
    Button("Cleared Browsing Data") { center.show(.clearedBrowsingData) }
    Button("Tab From Mac") { center.show(.tabReceived(from: "Luke's MacBook Pro")) }
  }
  .buttonStyle(.bordered)
  .frame(maxWidth: .infinity, maxHeight: .infinity)
  .toastOverlay(center)
}

#Preview("Toast Styles") {
  VStack(spacing: Spacing.small) {
    ToastView(toast: .copiedURL)
    ToastView(toast: .clearedBrowsingData)
    ToastView(toast: .tabReceived(from: "Luke's MacBook Pro"))
  }
  .padding()
}
