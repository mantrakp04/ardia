import ArdiaDesign
import SwiftUI

extension Palette {
  static let menuSheet = Color(.systemBackground)
  static let menuGroup = Color.adaptive(light: Color(.systemBackground), dark: Color(hex: 0x171717))
}

enum PageMenuLayout {
  static let groupSpacing: CGFloat = Spacing.page
  static let barSpacing: CGFloat = Spacing.tight
  static let zoomHeight: CGFloat = 32
  static let zoomButtonWidth: CGFloat = 40
}

struct WindowRoomReader: UIViewRepresentable {
  var onChange: (CGFloat) -> Void

  func makeUIView(context: Context) -> RoomView {
    let view = RoomView()
    view.onChange = onChange
    view.isUserInteractionEnabled = false
    return view
  }

  func updateUIView(_ view: RoomView, context: Context) {
    view.onChange = onChange
  }

  final class RoomView: UIView {
    var onChange: ((CGFloat) -> Void)?
    private var reported: CGFloat = 0

    override func didMoveToWindow() {
      super.didMoveToWindow()
      report()
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      report()
    }

    private func report() {
      guard let window else { return }
      let room = window.bounds.height - window.safeAreaInsets.top
      guard room > 0, room != reported else { return }
      reported = room
      let onChange = onChange
      DispatchQueue.main.async { onChange?(room) }
    }
  }
}

struct PageMenuGroup<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    VStack(spacing: 0) {
      Group(subviews: content) { subviews in
        ForEach(subviews.indices, id: \.self) { index in
          if index > 0 {
            Divider().padding(.leading, Spacing.page)
          }
          subviews[index]
        }
      }
    }
    .background(Palette.menuGroup, in: .rect(cornerRadius: MenuLayout.innerRadius, style: .continuous))
  }
}

struct PageMenuRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? Color(.systemFill) : .clear)
      .animation(.easeOut(duration: configuration.isPressed ? 0 : 0.2), value: configuration.isPressed)
  }
}

struct PageMenuPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.94 : 1)
      .animation(Motion.snappy, value: configuration.isPressed)
  }
}

struct PageMenuRowLabel<Accessory: View>: View {
  var title: Text
  @ViewBuilder var accessory: Accessory

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    HStack(spacing: Spacing.small) {
      title
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
      accessory
    }
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Spacing.small : 0)
    .frame(minHeight: MenuLayout.rowHeight)
    .contentShape(.rect)
  }
}

struct PageMenuRow: View {
  var title: LocalizedStringKey
  var enabled = true
  var action: () -> Void

  init(_ title: LocalizedStringKey, enabled: Bool = true, action: @escaping () -> Void) {
    self.title = title
    self.enabled = enabled
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      PageMenuRowLabel(title: Text(title)) { EmptyView() }
    }
    .buttonStyle(PageMenuRowStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!enabled)
  }
}

struct PageMenuToggleRow: View {
  var title: LocalizedStringKey
  var detail: Text?
  @Binding var isOn: Bool

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Toggle(isOn: $isOn) {
      HStack(spacing: Spacing.small) {
        Text(title)
          .font(.callout)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let detail {
          detail
            .font(.subheadline)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .contentTransition(.numericText())
            .accessibilityLabel(Text("Blocked"))
            .accessibilityValue(detail)
        }
      }
    }
    .toggleStyle(.switch)
    .tint(Palette.success)
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Spacing.small : 0)
    .frame(minHeight: MenuLayout.rowHeight)
  }
}
