import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct BulletRow: View {
  var bullet: BrowseBullet
  var sources: [BrowseSource]

  @ScaledMetric(relativeTo: .body) private var tile: CGFloat = 28
  @ScaledMetric(relativeTo: .body) private var capHeight: CGFloat = 12

  var body: some View {
    let capHeight = capHeight
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      ZStack {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(IntelligencePalette.emojiTile)
        if !bullet.emoji.isEmpty {
          Text(bullet.emoji)
            .font(.system(size: tile * 0.57))
        } else {
          Circle().fill(IntelligencePalette.ink).frame(width: tile * 0.22, height: tile * 0.22)
        }
      }
      .frame(width: tile, height: tile)
      .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + capHeight / 2 }
      .accessibilityHidden(true)

      citedText
        .font(.body)
        .foregroundStyle(.primary)
        .textRenderer(CitationChipRenderer(fill: IntelligencePalette.followUpFill))
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var citedText: Text {
    let lead = bullet.lead.isEmpty ? Text(verbatim: "") : Text("\(bullet.lead): ").fontWeight(.semibold)
    var chips = Text(verbatim: "")
    for source in bullet.citations.compactMap({ number in sources.first { $0.number == number } }) {
      var label = AttributedString("\u{2009}\(source.number)\u{2009}")
      label.link = source.url
      label.foregroundColor = IntelligencePalette.ink
      let chip = Text(label)
        .font(.caption2.weight(.bold))
        .baselineOffset(2)
        .customAttribute(CitationChip())
        .accessibilityLabel(Text("Source \(source.number), \(source.siteName)"))
      chips = Text("\(chips)\u{2009}\(chip)")
    }
    return Text("\(lead)\(bullet.text)\(chips)")
  }
}

struct CitationChip: TextAttribute {}

struct CitationChipRenderer: TextRenderer {
  var fill: Color

  func draw(layout: Text.Layout, in context: inout GraphicsContext) {
    for line in layout {
      for run in line {
        if run[CitationChip.self] != nil {
          let bounds = run.typographicBounds.rect.insetBy(dx: 0, dy: -1)
          context.fill(Path(roundedRect: bounds, cornerRadius: bounds.height / 2.4, style: .continuous), with: .color(fill))
        }
        context.draw(run)
      }
    }
  }
}
