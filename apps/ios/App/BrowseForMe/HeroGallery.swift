import ArdiaDesign
import SwiftUI

struct HeroGallery: View {
  var images: [URL]

  var body: some View {
    HeroMosaicLayout(spacing: 10) {
      ForEach(images.prefix(3), id: \.self) { url in
        HeroImage(url: url)
      }
    }
    .frame(height: 205)
    .accessibilityHidden(true)
  }
}

struct HeroMosaicLayout: SwiftUI.Layout {
  var spacing: CGFloat
  var leadShare: CGFloat = 0.66

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    CGSize(width: proposal.width ?? 358, height: proposal.height ?? 205)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard let lead = subviews.first else { return }
    if subviews.count == 1 {
      lead.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
      return
    }
    let leadWidth = ((bounds.width - spacing) * leadShare).rounded()
    let sideWidth = bounds.width - spacing - leadWidth
    let sideX = bounds.minX + leadWidth + spacing
    lead.place(at: bounds.origin, proposal: ProposedViewSize(width: leadWidth, height: bounds.height))
    let side = subviews.dropFirst()
    let sideHeight = (bounds.height - spacing * CGFloat(side.count - 1)) / CGFloat(side.count)
    for (index, subview) in side.enumerated() {
      let y = bounds.minY + CGFloat(index) * (sideHeight + spacing)
      subview.place(at: CGPoint(x: sideX, y: y), proposal: ProposedViewSize(width: sideWidth, height: sideHeight))
    }
  }
}

private struct HeroImage: View {
  var url: URL

  var body: some View {
    AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2).delay(0.2))) { phase in
      switch phase {
      case .success(let image):
        image.resizable().scaledToFill().transition(.opacity)
      default:
        IntelligencePalette.skeleton
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipShape(.rect(cornerRadius: 8, style: .continuous))
  }
}
