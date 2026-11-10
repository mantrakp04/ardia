import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SuggestionRowView: View {
  let suggestion: SearchSuggestion
  let typed: String
  let isHighlighted: Bool
  let isIncognito: Bool

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @ScaledMetric(relativeTo: .body) private var pitch = BrowseLayout.suggestionPitch
  @ScaledMetric(relativeTo: .body) private var iconSlot: CGFloat = 22

  var body: some View {
    HStack(spacing: Spacing.small) {
      leading
        .frame(width: iconSlot, height: iconSlot)
      label
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.leading, 12)
    .padding(.trailing, 7)
    .frame(minHeight: pitch)
    .background {
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(isHighlighted ? rowHighlight : .clear)
    }
    .contentShape(.rect)
  }

  private var rowHighlight: Color {
    isIncognito ? .white.opacity(0.1) : Color.adaptive(light: .black.opacity(0.05), dark: .white.opacity(0.08))
  }

  @ViewBuilder
  private var leading: some View {
    if suggestion.showsFavicon, let url = suggestion.url {
      FaviconImage(iconURL: suggestion.favicon, pageURL: url, size: iconSlot * 0.82)
    } else {
      Image(systemName: suggestion.symbol)
        .font(.system(size: BrowseLayout.suggestionIcon, weight: .medium))
        .imageScale(.large)
        .foregroundStyle(isIncognito ? AnyShapeStyle(BrowsePalette.incognitoCaption) : AnyShapeStyle(BrowsePalette.rowIcon))
    }
  }

  @ViewBuilder
  private var label: some View {
    switch suggestion.kind {
    case .query:
      queryText
        .font(.title3)
        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 4 : 2)
        .fixedSize(horizontal: false, vertical: true)
    default:
      VStack(alignment: .leading, spacing: 1) {
        Text(suggestion.title)
          .font(.body)
          .foregroundStyle(primary)
          .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
        if let detail = detailText {
          detail
            .font(.subheadline)
            .foregroundStyle(secondary)
            .lineLimit(1)
        }
      }
    }
  }

  private var detailText: Text? {
    switch suggestion.kind {
    case .remoteTab(let device) where !device.isEmpty:
      Text("\(Image(systemName: "laptopcomputer")) \(suggestion.detail ?? device)")
    case .openTab:
      Text("\(Image(systemName: "arrow.right.circle")) Switch to Tab")
    default:
      suggestion.detail.map { Text($0) }
    }
  }

  private var queryText: Text {
    let title = suggestion.title
    let lower = title.lowercased()
    let typedLower = typed.trimmingCharacters(in: .whitespaces).lowercased()
    guard !typedLower.isEmpty, lower.hasPrefix(typedLower), title.count > typedLower.count else {
      return Text(title).foregroundStyle(primary)
    }
    let prefix = String(title.prefix(typedLower.count))
    let rest = String(title.dropFirst(typedLower.count))
    return Text("\(Text(prefix).foregroundStyle(secondary))\(Text(rest).foregroundStyle(primary))")
  }

  private var primary: Color {
    isIncognito ? .white.opacity(0.92) : BrowsePalette.foregroundPrimary
  }

  private var secondary: Color {
    isIncognito ? BrowsePalette.incognitoCaption : BrowsePalette.foregroundSecondary
  }
}

#Preview("Rows") {
  VStack(spacing: 0) {
    SuggestionRowView(suggestion: .query("paris olympics"), typed: "par", isHighlighted: false, isIncognito: false)
    SuggestionRowView(suggestion: .query("alphonso vs kesar mangoes"), typed: "", isHighlighted: false, isIncognito: false)
    SuggestionRowView(suggestion: .query("museum shows near me"), typed: "mu", isHighlighted: true, isIncognito: false)
    SuggestionRowView(
      suggestion: SearchSuggestion(id: "r", kind: .remoteTab(deviceName: "MacBook Pro"), title: "Lisbon - Wikipedia", detail: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Lisbon", query: "Lisbon"),
      typed: "lis", isHighlighted: false, isIncognito: false
    )
  }
  .padding(.horizontal, 8)
}
