import ArdiaBrowser
import ArdiaDesign
import SwiftUI

enum SuggestionTarget: Equatable {
  case row
  case browseForMe
}

struct SuggestionRowView: View {
  let suggestion: SearchSuggestion
  let typed: String
  let highlight: SuggestionTarget?
  let isIncognito: Bool
  var emphasizesPill = false
  var offersBrowseForMe = true
  var onBrowseForMe: (() -> Void)?

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @ScaledMetric(relativeTo: .body) private var pitch = BrowseLayout.suggestionPitch
  @ScaledMetric(relativeTo: .body) private var iconSlot: CGFloat = 22

  var body: some View {
    HStack(spacing: Spacing.small) {
      leading
        .frame(width: iconSlot, height: iconSlot)
      VStack(alignment: .leading, spacing: Spacing.tight) {
        label
        if let onBrowseForMe, offersBrowseForMe, suggestion.offersBrowseForMe, dynamicTypeSize.isAccessibilitySize {
          Button(action: onBrowseForMe) {
            BrowseForMePill(isHighlighted: true, isIncognito: isIncognito, fitsText: true)
              .padding(.vertical, 6)
          }
          .buttonStyle(.plain)
          .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if offersBrowseForMe, suggestion.offersBrowseForMe, !dynamicTypeSize.isAccessibilitySize {
        BrowseForMePill(isHighlighted: highlight != nil || emphasizesPill, isIncognito: isIncognito)
      }
    }
    .padding(.leading, 12)
    .padding(.trailing, 7)
    .frame(minHeight: pitch)
    .background {
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(highlight != nil ? rowHighlight : .clear)
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

struct BrowseForMePill: View {
  let isHighlighted: Bool
  var isIncognito = false
  var fitsText = false

  var body: some View {
    let size = isHighlighted ? BrowseLayout.highlightedPillSize : BrowseLayout.pillSize
    Text("Browse for Me")
      .font(.caption.weight(.semibold))
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .foregroundStyle(isHighlighted ? .white : (isIncognito ? .white.opacity(0.85) : BrowsePalette.pillLabel))
      .padding(.horizontal, 8)
      .frame(minWidth: size.width, minHeight: size.height)
      .background {
        RoundedRectangle(cornerRadius: BrowseLayout.pillRadius, style: .continuous)
          .fill(isHighlighted ? AnyShapeStyle(BrowsePalette.highlightedPill.gradient) : AnyShapeStyle(isIncognito ? Color.white.opacity(0.12) : BrowsePalette.pillFill))
          .shadow(color: isHighlighted ? Palette.indigo.opacity(0.35) : .clear, radius: 8, y: 3)
      }
      .frame(width: fitsText ? nil : BrowseLayout.highlightedPillSize.width, height: fitsText ? nil : BrowseLayout.highlightedPillSize.height, alignment: .trailing)
      .animation(Motion.modeToggle, value: isHighlighted)
      .accessibilityHidden(true)
  }
}

#Preview("Rows") {
  VStack(spacing: 0) {
    SuggestionRowView(suggestion: .query("paris olympics"), typed: "par", highlight: .browseForMe, isIncognito: false)
    SuggestionRowView(suggestion: .query("alphonso vs kesar mangoes"), typed: "", highlight: nil, isIncognito: false)
    SuggestionRowView(suggestion: .query("museum shows near me"), typed: "mu", highlight: .row, isIncognito: false)
    SuggestionRowView(
      suggestion: SearchSuggestion(id: "r", kind: .remoteTab(deviceName: "MacBook Pro"), title: "Lisbon - Wikipedia", detail: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Lisbon", query: "Lisbon"),
      typed: "lis", highlight: nil, isIncognito: false
    )
  }
  .padding(.horizontal, 8)
}
