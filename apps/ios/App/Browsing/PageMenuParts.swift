import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageMenuGroup<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    VStack(spacing: 0) {
      Group(subviews: content) { subviews in
        ForEach(subviews.indices, id: \.self) { index in
          if index > 0 {
            Rectangle()
              .fill(Tokens.Role.divider)
              .frame(height: Tokens.Hairline.panel)
              .padding(.leading, PageMenuLayout.rowPadding)
          }
          subviews[index]
        }
      }
    }
    .background(Tokens.Role.card, in: .rect(cornerRadius: PageMenuLayout.groupRadius, style: .continuous))
  }
}

struct PageMenuRowLabel<Accessory: View>: View {
  let title: LocalizedStringKey
  @ViewBuilder var accessory: Accessory

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    HStack(spacing: PageMenuLayout.rowGap) {
      Text(title)
        .font(Typography.body)
        .frame(maxWidth: .infinity, alignment: .leading)
      accessory
    }
    .padding(.horizontal, PageMenuLayout.rowPadding)
    .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Tokens.Space.l : 0)
    .frame(minHeight: PageMenuLayout.rowHeight)
    .contentShape(.rect)
  }
}

struct PageMenuButtonRow: View {
  let title: LocalizedStringKey
  var enabled = true
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      PageMenuRowLabel(title: title) { EmptyView() }
    }
    .buttonStyle(PageMenuRowStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(Tokens.Role.textPrimary) : AnyShapeStyle(Tokens.Role.textTertiary))
    .disabled(!enabled)
  }
}

struct PageMenuToggleRow: View {
  let title: LocalizedStringKey
  var detail: Text?
  var enabled = true
  @Binding var isOn: Bool

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Toggle(isOn: $isOn) {
      HStack(spacing: PageMenuLayout.rowGap) {
        Text(title)
          .font(Typography.body)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let detail {
          detail
            .font(Typography.caption)
            .monospacedDigit()
            .foregroundStyle(Tokens.Role.textSecondary)
            .contentTransition(.numericText())
            .accessibilityLabel(Text("Blocked"))
            .accessibilityValue(detail)
        }
      }
    }
    .toggleStyle(.switch)
    .tint(Tokens.Role.success.color)
    .padding(.horizontal, PageMenuLayout.rowPadding)
    .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Tokens.Space.l : 0)
    .frame(minHeight: PageMenuLayout.rowHeight)
    .disabled(!enabled)
  }
}

struct PageZoomRow: View {
  let page: WebTab
  let enabled: Bool

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let isLarge = dynamicTypeSize.isAccessibilitySize
    let layout = isLarge
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Tokens.Space.m))
      : AnyLayout(HStackLayout(spacing: PageMenuLayout.rowGap))
    let canZoomOut = page.pageZoom > (WebTab.zoomLevels.first ?? 0.5)
    let canZoomIn = page.pageZoom < (WebTab.zoomLevels.last ?? 3)
    layout {
      Text("Page Zoom")
        .font(Typography.body)
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 0) {
        stepButton("minus", label: "Zoom Out", enabled: canZoomOut) { page.zoomOut() }
        Button {
          page.setPageZoom(1)
        } label: {
          Text(page.pageZoom, format: .percent.precision(.fractionLength(0)))
            .font(Typography.row.weight(Tokens.Weight.semibold))
            .monospacedDigit()
            .fixedSize()
            .contentTransition(.numericText(value: page.pageZoom))
            .frame(minWidth: PageMenuLayout.zoomValueWidth)
        }
        .foregroundStyle(Tokens.Role.textPrimary)
        .accessibilityLabel("Reset Zoom")
        .accessibilityValue(Text(page.pageZoom, format: .percent.precision(.fractionLength(0))))
        stepButton("plus", label: "Zoom In", enabled: canZoomIn) { page.zoomIn() }
      }
      .font(Typography.body.weight(Tokens.Weight.medium))
      .background(Tokens.Role.pinnedResting, in: .capsule)
    }
    .buttonStyle(.plain)
    .padding(.horizontal, PageMenuLayout.rowPadding)
    .padding(.vertical, isLarge ? Tokens.Space.l : 0)
    .frame(minHeight: PageMenuLayout.rowHeight)
    .animation(Tokens.Spring.snappy.animation, value: page.pageZoom)
    .disabled(!enabled)
  }

  private func stepButton(_ symbol: String, label: LocalizedStringKey, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .frame(width: PageMenuLayout.zoomButton.width, height: PageMenuLayout.zoomButton.height)
        .contentShape(.rect)
    }
    .foregroundStyle(enabled ? AnyShapeStyle(Tokens.Role.textPrimary) : AnyShapeStyle(Tokens.Role.textTertiary))
    .disabled(!enabled)
    .accessibilityLabel(label)
  }
}

struct PageMenuTile: View {
  let symbol: String
  let title: LocalizedStringKey
  let enabled: Bool
  let action: () -> Void

  @ScaledMetric(relativeTo: .body) private var tileHeight = PageMenuLayout.tileHeight

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(Typography.body.weight(Tokens.Weight.semibold))
        .frame(maxWidth: .infinity, minHeight: tileHeight)
        .contentShape(.capsule)
    }
    .buttonStyle(.glassControl(.capsule))
    .foregroundStyle(enabled ? AnyShapeStyle(Tokens.Role.textPrimary) : AnyShapeStyle(Tokens.Role.textTertiary))
    .disabled(!enabled)
    .accessibilityLabel(title)
    .help(title)
  }
}

struct PageMenuRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? AnyShapeStyle(Tokens.Role.pinnedResting) :AnyShapeStyle(.clear))
      .animation(.easeOut(duration: configuration.isPressed ? 0 : Tokens.Duration.slow), value: configuration.isPressed)
  }
}
