import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct FollowUpChips: View {
  var questions: [String]
  var onAsk: (String) -> Void

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(questions, id: \.self) { question in
          Button { onAsk(question) } label: {
            Text(question)
              .font(.body.weight(.semibold))
              .foregroundStyle(IntelligencePalette.ink)
              .lineLimit(1)
              .padding(.horizontal, 16)
              .frame(minHeight: 44)
              .background(IntelligencePalette.followUpFill, in: .capsule)
          }
          .buttonStyle(PressableCardStyle())
          .accessibilityHint("Browses for this in a new tab")
        }
      }
      .padding(.horizontal, Spacing.page)
    }
    .scrollIndicators(.hidden)
    .scrollClipDisabled()
  }
}

struct QuoteCard: View {
  var quote: BrowseQuote
  var source: BrowseSource
  var onOpen: () -> Void

  var body: some View {
    Button(action: onOpen) {
      VStack(alignment: .leading, spacing: 14) {
        Text("\u{201C}\(quote.text)\u{201D}")
          .font(.body)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.leading)
          .fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 10) {
          FaviconImage(iconURL: source.faviconURL?.absoluteString, pageURL: source.url.absoluteString, size: 20)
          VStack(alignment: .leading, spacing: 0) {
            Text(source.title)
              .font(.subheadline)
              .foregroundStyle(.primary)
              .lineLimit(1)
            Text(SourceCardModel.host(source.url))
              .font(.footnote)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(IntelligencePalette.quoteBackground, in: .rect(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(PressableCardStyle())
    .accessibilityElement(children: .combine)
    .accessibilityHint("Opens \(source.siteName)")
  }
}

struct SourcesSection: View {
  var title: String
  var links: [(url: URL, title: String)]
  var onOpen: (URL) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      SectionHeading(title)
        .padding(.bottom, 6)
      ForEach(links, id: \.url) { link in
        Button { onOpen(link.url) } label: {
          HStack(alignment: .top, spacing: 12) {
            FaviconImage(iconURL: nil, pageURL: link.url.absoluteString, size: 20)
              .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
              Text(link.title)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
              Text(SourceCardModel.host(link.url))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding(.vertical, 8)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
      }
    }
  }
}

struct SectionHeading: View {
  var text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text)
      .font(.title2.weight(.bold))
      .foregroundStyle(IntelligencePalette.ink)
      .accessibilityAddTraits(.isHeader)
  }
}
