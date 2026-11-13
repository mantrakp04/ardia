import ArdiaBrowser
import ArdiaDesign
import QuartzCore
import SwiftUI
import UIKit

@Observable
final class TabSwipe {
  let pager = PagerModel()
  var pageWidth: CGFloat = 402
  private(set) var switchTicks = 0

  func track(_ translation: CGSize, app: AppModel) {
    if !pager.isTracking {
      guard abs(translation.width) > abs(translation.height) else { return }
      if pager.isActive {
        pager.catchSettle()
      } else {
        guard pager.begin(order: app.swipeOrder, currentID: app.tabs.selectedTabID) else { return }
        app.rememberCurrentCover()
      }
      pager.isTracking = true
      pager.trackingBase = rawOffset(for: pager.offset)
      pager.activationTranslation = translation.width
    }
    let raw = pager.trackingBase + translation.width - pager.activationTranslation
    place(raw)
  }

  func release(velocity: CGFloat, app: AppModel, reduceMotion: Bool) {
    guard pager.isTracking else { return }
    pager.isTracking = false
    let target = PagerPhysics.snapTarget(offset: pager.offset, velocity: velocity, width: pageWidth, hasLeft: pager.hasLeft, hasRight: pager.hasRight)
    settle(to: target, velocity: velocity, app: app, reduceMotion: reduceMotion)
  }

  func warmNeighbors(app: AppModel) {
    let order = app.swipeOrder
    guard let index = order.firstIndex(where: { $0.id == app.tabs.selectedTabID }) else { return }
    let neighbors = [index - 1, index + 1].filter(order.indices.contains).map { order[$0] }
    let keep = Set(neighbors.map(\.id))
    pager.images = pager.images.filter { keep.contains($0.key) }
    for tab in neighbors where pager.images[tab.id] == nil && app.browse.covers.image(for: tab.id) == nil && app.deck.memoryImage(for: tab.id) == nil {
      guard let name = tab.snapshotFileName else { continue }
      let id = tab.id
      let pager = pager
      Task {
        guard let image = await app.web.snapshots.image(named: name) else { return }
        pager.images[id] = UIImage(cgImage: image)
      }
    }
  }

  func settle(to target: Int, velocity: CGFloat, app: AppModel, reduceMotion: Bool) {
    let destination = CGFloat(target) * pageWidth
    let neighbor = target > 0 ? pager.left : target < 0 ? pager.right : nil
    let from = pager.offset
    let distance = destination - from
    pager.generation += 1
    let generation = pager.generation
    if neighbor != nil { switchTicks += 1 }
    let animation: Animation
    if reduceMotion {
      animation = Motion.pagerFade
      pager.settle = nil
    } else {
      let releaseVelocity = min(max(velocity, -4000), 4000)
      animation = .interpolatingSpring(Motion.pagerSettle, initialVelocity: abs(distance) > 0.5 ? Double(releaseVelocity / distance) : 0)
      pager.settle = PagerModel.Settle(from: from, to: destination, velocity: releaseVelocity, start: CACurrentMediaTime())
    }
    let pager = pager
    withAnimation(animation, completionCriteria: .removed) {
      pager.offset = destination
    } completion: {
      guard pager.generation == generation, !pager.isTracking else { return }
      guard let neighbor else {
        pager.reset()
        return
      }
      Self.withoutAnimation {
        app.browse.freezeOrder(pager.order.map(\.id))
        app.openTab(neighbor.id)
        pager.reset()
      }
    }
  }

  func grab(app: AppModel) -> Bool {
    if pager.isActive {
      pager.catchSettle()
      return true
    }
    app.rememberCurrentCover()
    return pager.begin(order: app.swipeOrder, currentID: app.tabs.selectedTabID)
  }

  func drag(to fraction: CGFloat, over seconds: Double) async {
    let start = rawOffset(for: pager.offset)
    let steps = max(Int(seconds * 120), 1)
    for step in 1...steps {
      let progress = CGFloat(step) / CGFloat(steps)
      place(start + (fraction * pageWidth - start) * progress)
      try? await Task.sleep(for: .milliseconds(8))
    }
  }

  func freeze(at fraction: CGFloat, app: AppModel) {
    app.rememberCurrentCover()
    guard pager.begin(order: app.swipeOrder, currentID: app.tabs.selectedTabID) else { return }
    pager.offset = PagerPhysics.resolvedOffset(-fraction * pageWidth, hasLeft: pager.hasLeft, hasRight: pager.hasRight, width: pageWidth)
  }

  private func place(_ raw: CGFloat) {
    let offset = PagerPhysics.resolvedOffset(raw, hasLeft: pager.hasLeft, hasRight: pager.hasRight, width: pageWidth)
    Self.withoutAnimation { pager.offset = offset }
  }

  private func rawOffset(for offset: CGFloat) -> CGFloat {
    if offset > 0, !pager.hasLeft { return offset / max(1 - offset / PagerPhysics.rubberLimit, 0.05) }
    if offset < 0, !pager.hasRight { return offset / max(1 + offset / PagerPhysics.rubberLimit, 0.05) }
    return offset
  }

  private static func withoutAnimation(_ body: () -> Void) {
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction, body)
  }
}

struct TabSwipeGesture: ViewModifier {
  let swipe: TabSwipe
  let isEnabled: Bool

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content.highPriorityGesture(
      DragGesture(minimumDistance: TabSwipeMetrics.activationDistance)
        .onChanged { swipe.track($0.translation, app: app) }
        .onEnded { swipe.release(velocity: $0.velocity.width, app: app, reduceMotion: reduceMotion) },
      isEnabled: isEnabled
    )
  }
}

enum TabSwipeMetrics {
  static let activationDistance: CGFloat = 14
}

extension View {
  func tabSwipeGesture(_ swipe: TabSwipe, isEnabled: Bool = true) -> some View {
    modifier(TabSwipeGesture(swipe: swipe, isEnabled: isEnabled))
  }
}
