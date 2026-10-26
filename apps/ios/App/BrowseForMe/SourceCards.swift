import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct SourceCardModel: Identifiable, Hashable {
  enum Fill: Hashable {
    case waiting
    case read
    case unavailable
  }

  var id: Int
  var url: URL
  var title: String
  var host: String
  var fill: Fill

  static func cards(for browse: BrowseForMe) -> [SourceCardModel] {
    if browse.phase == .done, !browse.page.sources.isEmpty {
      return browse.page.sources.map {
        SourceCardModel(id: $0.number, url: $0.url, title: $0.title, host: Self.host($0.url), fill: .read)
      }
    }
    return browse.sources.map { progress in
      let fill: Fill =
        switch progress.state {
        case .queued, .reading: .waiting
        case .read, .condensing: .read
        case .failed, .skipped: .unavailable
        }
      return SourceCardModel(
        id: progress.id, url: progress.result.url, title: progress.result.title, host: progress.result.displayHost,
        fill: fill)
    }
  }

  static func host(_ url: URL) -> String {
    let host = url.host() ?? url.absoluteString
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }
}

struct SourceCardsRow: View {
  var query: String
  var engineName: String
  var cards: [SourceCardModel]
  var showsPlaceholders: Bool
  var onSearch: () -> Void
  var onOpen: (URL) -> Void

  @ScaledMetric(relativeTo: .subheadline) private var cardWidth: CGFloat = 134
  @ScaledMetric(relativeTo: .subheadline) private var cardHeight: CGFloat = 86

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        SearchEngineCard(query: query, engineName: engineName, action: onSearch)
          .frame(width: min(cardWidth, 300), height: min(cardHeight, 230))
        ForEach(cards) { card in
          SourceCard(card: card) { onOpen(card.url) }
            .frame(width: min(cardWidth, 300), height: min(cardHeight, 230))
            .transition(.opacity.combined(with: .scale(scale: 0.96)))
        }
        if showsPlaceholders, cards.isEmpty {
          ForEach(0..<3, id: \.self) { _ in
            SkeletonCard()
              .frame(width: min(cardWidth, 300), height: min(cardHeight, 230))
          }
        }
      }
      .padding(.horizontal, Spacing.page)
      .animation(IntelligenceMotion.cardFill, value: cards)
    }
    .scrollIndicators(.hidden)
    .scrollClipDisabled()
  }
}

private struct SearchEngineCard: View {
  var query: String
  var engineName: String
  var action: () -> Void

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 0) {
        if !typeSize.isAccessibilitySize {
          queryCapsule
          Divider()
        }
        Text("Search \(engineName)")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
          .lineLimit(3)
          .padding(10)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
      .background(IntelligencePalette.card, in: .rect(cornerRadius: 8, style: .continuous))
    }
    .buttonStyle(PressableCardStyle())
    .accessibilityLabel("Search \(engineName) for \(query)")
  }

  private var queryCapsule: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(IntelligencePalette.ink)
      Text(query)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(IntelligencePalette.pageBackground, in: .capsule)
    .padding(10)
  }
}

private struct SourceCard: View {
  var card: SourceCardModel
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 0) {
        if card.fill == .waiting {
          SkeletonLines(widths: [1, 1, 0.55], height: 7)
            .padding(10)
          Spacer(minLength: 0)
          RoundedRectangle(cornerRadius: 3).fill(IntelligencePalette.cardSkeleton)
            .frame(width: 44, height: 7)
            .padding([.horizontal, .bottom], 10)
        } else {
          Text(card.title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .padding([.horizontal, .top], 10)
          Spacer(minLength: 4)
          HStack(spacing: 5) {
            FaviconImage(iconURL: nil, pageURL: card.url.absoluteString, size: 16)
            Text(card.host)
              .font(.footnote)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          .padding([.horizontal, .bottom], 10)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .background(IntelligencePalette.card, in: .rect(cornerRadius: 8, style: .continuous))
      .opacity(card.fill == .unavailable ? 0.45 : 1)
    }
    .buttonStyle(PressableCardStyle())
    .disabled(card.fill == .waiting)
    .accessibilityLabel(card.fill == .waiting ? Text("Reading") : Text("\(card.title), \(card.host)"))
  }
}

private struct SkeletonCard: View {
  var body: some View {
    VStack(alignment: .leading) {
      SkeletonLines(widths: [1, 1, 0.55], height: 7)
      Spacer(minLength: 0)
    }
    .padding(10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(IntelligencePalette.card, in: .rect(cornerRadius: 8, style: .continuous))
    .accessibilityHidden(true)
  }
}

struct SkeletonLines: View {
  var widths: [CGFloat]
  var height: CGFloat

  var body: some View {
    VStack(alignment: .leading, spacing: height * 0.8) {
      ForEach(widths.enumerated(), id: \.offset) { _, fraction in
        RoundedRectangle(cornerRadius: height / 2, style: .continuous)
          .fill(IntelligencePalette.cardSkeleton)
          .frame(height: height)
          .frame(maxWidth: .infinity, alignment: .leading)
          .scaleEffect(x: fraction, anchor: .leading)
      }
    }
    .accessibilityHidden(true)
  }
}
