import ArdiaDesign
import SwiftUI

struct SidebarNewTabRow: View {
  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @Environment(\.interfaceStyle) private var interfaceStyle
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @State private var isHovering = false

  var body: some View {
    if interfaceStyle.resolved(reduceTransparency: reduceTransparency) == .glass {
      button.buttonStyle(.glassControl(.row))
    } else {
      button
        .buttonStyle(SidebarRowStyle(isSelected: false, isHovered: isHovering))
        .onHover { isHovering = $0 }
    }
  }

  private var button: some View {
    Button {
      sidebar.dismissOverlay()
      app.newTab()
    } label: {
      HStack(spacing: SidebarChrome.RowParts.titleGap) {
        Image(systemName: "plus")
          .font(Typography.row.weight(Tokens.Weight.medium))
          .foregroundStyle(SidebarChrome.RowParts.newTabGlyph)
          .frame(width: SidebarMetrics.Row.icon, height: SidebarMetrics.Row.icon)
        Text(String(localized: "New Tab"))
          .font(Typography.row)
          .foregroundStyle(SidebarChrome.RowParts.newTabLabel)
          .lineLimit(1)
      }
      .padding(.leading, SidebarChrome.RowParts.contentLeading)
      .frame(minWidth: 0, maxWidth: .infinity, minHeight: SidebarMetrics.Row.height, alignment: .leading)
    }
    .accessibilityHint(String(localized: "Opens the command bar."))
  }
}
