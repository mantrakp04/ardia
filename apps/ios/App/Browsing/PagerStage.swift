import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct PagerStage: View {
  let pager: PagerModel
  let reduceMotion: Bool

  var body: some View {
    GeometryReader { proxy in
      let size = CGSize(
        width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing,
        height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
      )
      let layout = PagerPhysics.layout(offset: pager.offset, width: size.width, hasLeft: pager.hasLeft, hasRight: pager.hasRight, reduceMotion: reduceMotion)
      let incoming = layout.incomingSide < 0 ? pager.left : layout.incomingSide > 0 ? pager.right : nil
      ZStack {
        Color.black
        if let current = pager.current {
          PagerCard(tab: current, image: pager.images[current.id], pose: layout.outgoing, size: size, statusHeight: proxy.safeAreaInsets.top, shadowEdge: 0)
        }
        if let incoming, let pose = layout.incoming {
          PagerCard(tab: incoming, image: pager.images[incoming.id], pose: pose, size: size, statusHeight: proxy.safeAreaInsets.top, shadowEdge: -layout.incomingSide)
            .id(incoming.id)
        }
      }
      .frame(width: size.width, height: size.height)
    }
    .ignoresSafeArea()
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

struct PagerCard: View {
  let tab: BrowserTab
  let image: UIImage?
  let pose: PagerCardPose
  let size: CGSize
  let statusHeight: CGFloat
  let shadowEdge: Int

  @Environment(AppModel.self) private var app

  private static let shadowWidth: CGFloat = 36

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: TabsLayout.displayCornerRadius, style: .continuous)
    PagerSnapshot(tab: tab, preloaded: image)
      .overlay(alignment: .top) { statusTone }
      .frame(width: size.width, height: size.height)
      .overlay { Color.black.opacity(pose.dim) }
      .clipShape(shape)
      .overlay(alignment: shadowEdge < 0 ? .leading : .trailing) { edgeShadow }
      .scaleEffect(pose.scale)
      .offset(x: pose.x)
      .opacity(pose.opacity)
  }

  @ViewBuilder
  private var statusTone: some View {
    if tab.origin != .browseForMe, let top = app.browse.tone(for: tab, page: app.web.existingWebTab(tab.id)).top {
      top.color.frame(height: statusHeight)
    }
  }

  @ViewBuilder
  private var edgeShadow: some View {
    if shadowEdge != 0 {
      LinearGradient(
        colors: [.black.opacity(0), .black.opacity(0.08), .black.opacity(0.26)],
        startPoint: shadowEdge < 0 ? .leading : .trailing,
        endPoint: shadowEdge < 0 ? .trailing : .leading
      )
      .frame(width: Self.shadowWidth)
      .padding(.vertical, TabsLayout.displayCornerRadius * 0.6)
      .offset(x: CGFloat(shadowEdge) * Self.shadowWidth)
      .opacity(pose.shadow)
    }
  }
}

struct PagerSnapshot: View {
  let tab: BrowserTab
  var preloaded: UIImage?

  @Environment(AppModel.self) private var app
  @State private var image: CGImage?

  var body: some View {
    ZStack(alignment: .top) {
      BrowsePalette.pageBackdrop
      if let memory = app.browse.covers.image(for: tab.id) ?? app.deck.memoryImage(for: tab.id) ?? preloaded {
        Image(uiImage: memory).resizable().scaledToFill()
      } else if let image {
        Image(decorative: image, scale: 1).resizable().scaledToFill()
      } else {
        PageLoadingPlaceholder(tab: tab)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .clipped()
    .task(id: tab.snapshotFileName) {
      guard preloaded == nil, let name = tab.snapshotFileName else { return }
      image = await app.web.snapshots.image(named: name)
    }
  }
}
