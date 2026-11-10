import ArdiaDesign
import SwiftUI

struct DeckHeaderLayout: SwiftUI.Layout {
  var titleReveal: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let heights = subviews.map { $0.sizeThatFits(.unspecified).height }
    return CGSize(width: proposal.width ?? 0, height: heights.max() ?? 0)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard subviews.count == 2 else { return }
    let icon = subviews[0].sizeThatFits(.unspecified)
    let title = subviews[1].sizeThatFits(.unspecified)
    let leading = bounds.minX + DeckHeaderMetrics.contentLeading(
      available: bounds.width, icon: icon.width, spacing: TabsLayout.headerSpacing, title: title.width, reveal: titleReveal
    )
    subviews[0].place(at: CGPoint(x: leading, y: bounds.midY), anchor: .leading, proposal: ProposedViewSize(icon))
    subviews[1].place(at: CGPoint(x: leading + icon.width + TabsLayout.headerSpacing, y: bounds.midY), anchor: .leading, proposal: ProposedViewSize(title))
  }
}

extension EnvironmentValues {
  @Entry var deckHeaderWidth: CGFloat = .infinity
}
