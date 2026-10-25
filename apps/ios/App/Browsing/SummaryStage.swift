import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SummaryStage: View {
  let tabID: UUID
  let snapshot: UIImage?
  let title: String
  let pageURL: String
  let faviconURL: String?
  var onClosed: () -> Void

  enum Phase {
    case page
    case edgeOn
    case card
  }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var phase: Phase = .page
  @State private var softened = false
  @State private var isClosing = false
  @State private var showsSummary = false

  static let cardHeight: CGFloat = 245

  var body: some View {
    GeometryReader { proxy in
      let full = CGSize(width: proxy.size.width, height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom)
      let cardTop = BrowseLayout.summaryCardTop - 59
      ZStack(alignment: .top) {
        backdrop
          .opacity(phase == .page ? 0 : 1)
          .ignoresSafeArea()
        header
          .padding(.top, max(cardTop - 26, 4))
          .opacity(phase == .card && !isClosing ? 1 : 0)
        card(full: full, safeTop: proxy.safeAreaInsets.top, cardTop: cardTop)
        SummaryView(tabID: tabID, onClose: close)
          .padding(.top, cardTop + Self.cardHeight + Spacing.small)
          .opacity(showsSummary && !isClosing ? 1 : 0)
          .allowsHitTesting(showsSummary && !isClosing)
      }
    }
    .onAppear(perform: fold)
  }

  private var backdrop: some View {
    ZStack {
      LaunchGradient(colors: BrowsePalette.summaryGradient)
      LinearGradient(colors: [Color(hex: 0xF1EEFA), Color(hex: 0xF7EEF4)], startPoint: .top, endPoint: .bottom)
        .opacity(softened ? 0.9 : 0)
    }
  }

  private var header: some View {
    HStack(spacing: 6) {
      FaviconImage(iconURL: faviconURL, pageURL: pageURL, size: 14)
      Text(title)
        .font(.caption)
        .foregroundStyle(softened ? BrowsePalette.foregroundSecondary : Color.white.opacity(0.8))
        .lineLimit(1)
    }
    .padding(.horizontal, Spacing.section)
    .frame(maxWidth: .infinity)
  }

  @ViewBuilder
  private func card(full: CGSize, safeTop: CGFloat, cardTop: CGFloat) -> some View {
    let isPage = phase == .page
    let width = isPage ? full.width : (phase == .edgeOn ? full.width * 0.84 : BrowseLayout.summaryCardWidth)
    let height = isPage ? full.height - safeTop : (phase == .edgeOn ? full.height * 0.42 : Self.cardHeight)
    let top = isPage ? 0 : (phase == .edgeOn ? (full.height - height) / 2 - safeTop : cardTop)
    ZStack(alignment: .top) {
      Rectangle().fill(.background)
      if let snapshot {
        Image(uiImage: snapshot)
          .resizable()
          .scaledToFill()
          .frame(width: width, height: height, alignment: .top)
      }
    }
    .frame(width: width, height: height, alignment: .top)
    .clipShape(.rect(cornerRadius: isPage ? 0 : 10, style: .continuous))
    .overlay {
      if !isPage {
        BookEdges()
          .stroke(.black.opacity(0.08), lineWidth: 1)
      }
    }
    .shadow(color: .black.opacity(isPage ? 0 : 0.22), radius: 18, y: 8)
    .rotation3DEffect(.degrees(phase == .edgeOn && !reduceMotion ? 80 : 0), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
    .offset(y: top)
    .frame(maxWidth: .infinity)
    .accessibilityLabel(title)
    .accessibilityAddTraits(.isImage)
  }

  private func fold() {
    guard phase == .page else { return }
    if reduceMotion {
      withAnimation(.easeOut(duration: 0.25)) {
        phase = .card
      } completion: {
        showsSummary = true
      }
      return
    }
    withAnimation(.easeIn(duration: 0.08)) {
      phase = .edgeOn
    } completion: {
      withAnimation(Motion.foldSettle) {
        phase = .card
      } completion: {
        withAnimation(.easeOut(duration: 0.3)) { showsSummary = true }
        withAnimation(.easeInOut(duration: 4)) { softened = true }
      }
    }
  }

  private func close() {
    guard !isClosing else { return }
    isClosing = true
    withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.summaryDismiss) {
      phase = .page
    } completion: {
      onClosed()
    }
  }
}

nonisolated struct BookEdges: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    for inset in [2.0, 4.0] {
      path.move(to: CGPoint(x: rect.minX - inset, y: rect.minY + 6 + inset))
      path.addLine(to: CGPoint(x: rect.minX - inset, y: rect.maxY - 6 - inset))
      path.move(to: CGPoint(x: rect.maxX + inset, y: rect.minY + 6 + inset))
      path.addLine(to: CGPoint(x: rect.maxX + inset, y: rect.maxY - 6 - inset))
    }
    return path
  }
}
