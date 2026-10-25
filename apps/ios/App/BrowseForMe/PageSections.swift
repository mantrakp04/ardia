import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct DiveDeeperSection: View {
  var questions: [String]
  var onAsk: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionHeading(BrowseCopy.diveDeeper)
      ForEach(questions, id: \.self) { question in
        Button { onAsk(question) } label: {
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(question)
              .font(.body.weight(.medium))
              .multilineTextAlignment(.leading)
              .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.up.right")
              .font(.subheadline.weight(.semibold))
          }
          .foregroundStyle(IntelligencePalette.ink)
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
          .background(IntelligencePalette.followUpFill, in: .rect(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressableCardStyle())
        .accessibilityHint("Browses for this question in a new tab")
      }
    }
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
      .font(.title3.weight(.bold))
      .foregroundStyle(IntelligencePalette.ink)
      .accessibilityAddTraits(.isHeader)
  }
}
