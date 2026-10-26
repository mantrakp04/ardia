import ArdiaDesign
import SwiftUI

struct SkeletonSection: View {
  @ScaledMetric(relativeTo: .body) private var tile: CGFloat = 28

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      RoundedRectangle(cornerRadius: 6, style: .continuous)
        .fill(IntelligencePalette.skeleton)
        .frame(width: tile, height: tile)
      VStack(alignment: .leading, spacing: 8) {
        ForEach(Array([1.0, 1.0, 0.4].enumerated()), id: \.offset) { _, fraction in
          RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(IntelligencePalette.skeleton)
            .frame(height: 8)
            .scaleEffect(x: fraction, anchor: .leading)
        }
      }
      .padding(.top, 4)
    }
    .accessibilityHidden(true)
  }
}
