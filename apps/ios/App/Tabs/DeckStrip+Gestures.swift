import ArdiaBrowser
import ArdiaDesign
import SwiftUI

extension DeckStrip {
  func open(_ id: UUID) {
    guard phase == .settled, lifts[id] == nil else { return }
    onInteraction()
    if reduceMotion {
      crossfadeOpen(id)
      return
    }
    phase = .closing(id)
    app.prepareToOpen(id)
    Task { @MainActor in
      await app.primeCover(for: id)
      if case .closing(id) = phase { app.beginOpening(id) }
    }
    withAnimation(TabsMotion.expand, completionCriteria: .removed) {
      scaleProgress = 0
      positionProgress = 0
    } completion: {
      app.openTab(id)
    }
  }

  func crossfadeOpen(_ id: UUID) {
    app.prepareToOpen(id)
    phase = .closing(id)
    Task { @MainActor in
      await app.primeCover(for: id)
      app.beginOpening(id)
      if let memory = app.deck.memoryImage(for: id) {
        cover = Image(uiImage: memory)
      } else if let name = app.tabs.tab(id)?.snapshotFileName, let image = await app.web.snapshots.image(named: name) {
        cover = Image(decorative: image, scale: 1)
      } else {
        app.openTab(id)
        return
      }
      coverOpacity = 0
      withAnimation(TabsMotion.fade) { coverOpacity = 1 } completion: { app.openTab(id) }
    }
  }

  func close(_ id: UUID, animated: Bool) {
    guard let index = order.firstIndex(of: id) else { return }
    onInteraction()
    let remove = {
      guard let index = order.firstIndex(of: id) else {
        lifts[id] = nil
        vanishing.remove(id)
        return
      }
      let remaining = order.count - 1
      let focus = TabsDeckGeometry.scrollAfterRemoving(index: index, scroll: Int(scroll.rounded()), remaining: remaining)
      let update = {
        order.remove(at: index)
        scroll = Double(focus)
      }
      if reduceMotion { withAnimation(TabsMotion.fade, update) } else { withAnimation(TabsMotion.gapClose, update) }
      app.closeTab(id)
      Task { @MainActor in
        try? await Task.sleep(for: .seconds(0.6))
        lifts[id] = nil
        vanishing.remove(id)
      }
    }
    guard animated, !reduceMotion else {
      remove()
      return
    }
    let relative = Double(index) - currentScroll
    let center = geometry.center(at: relative)
    let lift = (lifts[id] ?? 0) - Double(geometry.cardSize.height) * 0.18
    let spec = PoofBurst.Spec(center: CGPoint(x: center.x, y: center.y + CGFloat(lift)), size: geometry.cardSize.width * 0.9)
    poofs.append(spec)
    withAnimation(.easeOut(duration: TabsMotion.flyAway)) {
      lifts[id] = lift
      vanishing.insert(id)
    }
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(TabsMotion.flyAway * 0.6))
      remove()
    }
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(TabsMotion.poofDuration + 0.05))
      poofs.removeAll { $0.id == spec.id }
    }
  }

  func settle(to target: Int, velocity: Double = 0) {
    let clamped = min(max(target, 0), max(order.count - 1, 0))
    let from = currentScroll
    dragScroll = nil
    scroll = from
    settleOrigin = from
    let animation = reduceMotion ? TabsMotion.fade : TabsMotion.settle(distance: Double(clamped) - from, velocity: velocity)
    withAnimation(animation) {
      scroll = Double(clamped)
    } completion: {
      if scroll == Double(clamped) { settleOrigin = nil }
    }
  }

  func deckDrag(for id: UUID?) -> some Gesture {
    DragGesture(minimumDistance: 10)
      .onChanged { value in
        guard phase == .settled else { return }
        if axis == nil { beginDrag(value, on: id) }
        switch axis {
        case .horizontal:
          let raw = dragStart + geometry.scrollDelta(forDrag: value.translation.width)
          let banded = TabsDeckGeometry.rubberBand(raw, count: order.count)
          withoutAnimation { dragScroll = banded }
          tickIfFocusChanged(to: focusedCard(at: banded))
        case .vertical(let card):
          let dy = value.translation.height
          withoutAnimation { lifts[card] = dy < 0 ? dy : dy * 0.12 }
        case nil:
          break
        }
      }
      .onEnded { value in
        defer { axis = nil }
        switch axis {
        case .horizontal:
          let velocity = value.velocity.width
          let target = geometry.settleTarget(from: currentScroll, velocity: velocity, count: order.count)
          tickIfFocusChanged(to: target)
          tickedCard = nil
          settle(to: target, velocity: geometry.scrollDelta(forDrag: velocity))
        case .vertical(let card):
          if TabsDeckGeometry.shouldClose(translation: value.translation.height, velocity: value.velocity.height, cardHeight: geometry.cardSize.height) {
            flickTicks += 1
            close(card, animated: true)
          } else {
            withAnimation(TabsMotion.release) { lifts[card] = nil }
          }
        case nil:
          break
        }
      }
  }

  private func beginDrag(_ value: DragGesture.Value, on id: UUID?) {
    let dx = value.translation.width
    let dy = value.translation.height
    if let id, abs(dy) > abs(dx), dy < 0 {
      axis = .vertical(id)
    } else {
      axis = .horizontal
      dragStart = currentScroll
      tickedCard = focusedCard(at: currentScroll)
    }
    onInteraction()
  }

  private func withoutAnimation(_ change: () -> Void) {
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction, change)
  }

  private func focusedCard(at scroll: Double) -> Int {
    min(max(Int(scroll.rounded()), 0), max(order.count - 1, 0))
  }

  private func tickIfFocusChanged(to card: Int) {
    guard let tickedCard, tickedCard != card else { return }
    self.tickedCard = card
    focusTicks += 1
  }
}
