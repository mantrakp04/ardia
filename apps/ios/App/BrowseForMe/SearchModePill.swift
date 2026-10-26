import ArdiaDesign
import SwiftUI

enum BrowseMode: Hashable {
  case browse
  case search
}

struct SearchModePill: View {
  @Binding var mode: BrowseMode
  var engineName: String
  var engineURL: String

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Namespace private var selection
  @ScaledMetric(relativeTo: .body) private var segmentWidth: CGFloat = 40
  @ScaledMetric(relativeTo: .body) private var segmentHeight: CGFloat = 30

  var body: some View {
    HStack(spacing: 12) {
      segment(.browse) {
        ArdiaLogoMark(outline: mode == .browse)
          .frame(width: segmentHeight * 0.8)
      }
      segment(.search) {
        FaviconImage(iconURL: nil, pageURL: engineURL, size: segmentHeight * 0.66)
          .saturation(mode == .search ? 1 : 0)
          .opacity(mode == .search ? 1 : 0.7)
      }
    }
    .padding(6)
    .glassEffect(.regular.interactive(), in: .capsule)
    .shadow(color: .black.opacity(0.15), radius: 8, y: 1)
    .simultaneousGesture(
      DragGesture(minimumDistance: 4).onEnded { value in
        if value.translation.width > 4 { select(.search) }
        if value.translation.width < -4 { select(.browse) }
      })
    .sensoryFeedback(.selection, trigger: mode)
    .accessibilityRepresentation {
      Picker("Search Mode", selection: $mode) {
        Text("Browse for Me").tag(BrowseMode.browse)
        Text("Search with \(engineName)").tag(BrowseMode.search)
      }
      .pickerStyle(.segmented)
    }
  }

  private func segment(_ value: BrowseMode, @ViewBuilder label: () -> some View) -> some View {
    Button { select(value) } label: {
      label()
        .frame(width: segmentWidth, height: segmentHeight)
        .background {
          if mode == value {
            Capsule()
              .fill(LinearGradient(colors: IntelligencePalette.modeSelection, startPoint: .leading, endPoint: .trailing))
              .matchedGeometryEffect(id: "selection", in: selection)
          }
        }
        .contentShape(.capsule)
    }
    .buttonStyle(.plain)
  }

  private func select(_ value: BrowseMode) {
    guard value != mode else { return }
    withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : IntelligenceMotion.modeSwitch) { mode = value }
  }
}
