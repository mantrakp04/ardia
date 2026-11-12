import CoreGraphics
import Testing
@testable import ArdiaDesign

struct LoadProgressTests {
  @Test func fastLoadNeverShows() {
    var track = LoadProgress()
    track.start()
    track.advance(to: 0.6)
    track.finish()
    #expect(track.phase == .idle)
    #expect(!track.isVisible)
    #expect(track.fraction == 0)
  }

  @Test func onlyMovesForwardWhileLoading() {
    var track = LoadProgress()
    track.start()
    track.reveal()
    var seen: [Double] = [track.fraction]
    for raw in [0.3, 0.1, 0.5, 0, 0.45, 0.9, 0.99, .nan] {
      track.advance(to: raw)
      seen.append(track.fraction)
    }
    #expect(seen == seen.sorted())
    #expect(track.fraction == LoadProgress.ceiling)
  }

  @Test func revealStartsAtTheFloor() {
    var track = LoadProgress()
    track.start()
    track.advance(to: 0.02)
    track.reveal()
    #expect(track.fraction == LoadProgress.floor)
  }

  @Test func finishFillsThenFadesThenResets() {
    var track = LoadProgress()
    track.start()
    track.reveal()
    track.advance(to: 0.7)
    track.finish()
    #expect(track.phase == .finishing)
    #expect(track.fraction == 1)
    track.advance(to: 0)
    #expect(track.fraction == 1)
    track.fade()
    #expect(!track.isVisible)
    #expect(track.fraction == 1)
    track.settle()
    #expect(track.phase == .idle)
    #expect(track.fraction == 0)
  }

  @Test func aLoadThatStartsDuringTheFadeWaitsForIt() {
    var track = LoadProgress()
    track.start()
    track.reveal()
    track.finish()
    track.start()
    #expect(track.fraction == 1)
    track.fade()
    track.settle()
    #expect(track.phase == .waiting)
    #expect(track.fraction == 0)
  }

  @Test func aRedirectThatEndsDuringTheFadeDoesNotRestart() {
    var track = LoadProgress()
    track.start()
    track.reveal()
    track.finish()
    track.start()
    track.finish()
    track.fade()
    track.settle()
    #expect(track.phase == .idle)
  }
}

struct PagerPhysicsTests {
  let width: CGFloat = 402

  @Test func slowDragPastHalfCommits() {
    #expect(PagerPhysics.snapTarget(offset: -220, velocity: 0, width: width, hasLeft: true, hasRight: true) == -1)
    #expect(PagerPhysics.snapTarget(offset: 220, velocity: 0, width: width, hasLeft: true, hasRight: true) == 1)
  }

  @Test func shortFlickCommitsByProjection() {
    #expect(PagerPhysics.snapTarget(offset: -60, velocity: -1600, width: width, hasLeft: true, hasRight: true) == -1)
  }

  @Test func flickingBackCancels() {
    #expect(PagerPhysics.snapTarget(offset: -260, velocity: 900, width: width, hasLeft: true, hasRight: true) == 0)
  }

  @Test func noNeighborNeverCommits() {
    #expect(PagerPhysics.snapTarget(offset: -300, velocity: -2000, width: width, hasLeft: true, hasRight: false) == 0)
    #expect(PagerPhysics.snapTarget(offset: 300, velocity: 2000, width: width, hasLeft: false, hasRight: true) == 0)
  }

  @Test func rubberBandIsMonotonicAndBounded() {
    var last: CGFloat = 0
    for distance in stride(from: CGFloat(1), through: 2000, by: 25) {
      let banded = PagerPhysics.rubberBand(distance)
      #expect(banded > last)
      #expect(banded < PagerPhysics.rubberLimit)
      #expect(PagerPhysics.rubberBand(-distance) == -banded)
      last = banded
    }
  }

  @Test func outgoingRecedesAndIncomingArrivesFlush() {
    let start = PagerPhysics.layout(offset: -1, width: width, hasLeft: true, hasRight: true, reduceMotion: false)
    let end = PagerPhysics.layout(offset: -width, width: width, hasLeft: true, hasRight: true, reduceMotion: false)
    #expect(start.incomingSide == 1)
    #expect(end.incoming?.x == 0)
    #expect(end.incoming?.scale == 1)
    #expect(end.outgoing.scale == PagerPhysics.recededScale)
    #expect(end.outgoing.dim == PagerPhysics.recededDim)
    #expect(start.outgoing.scale > end.outgoing.scale)
  }

  @Test func leftNeighborComesFromTheLeft() {
    let layout = PagerPhysics.layout(offset: 120, width: width, hasLeft: true, hasRight: false, reduceMotion: false)
    #expect(layout.incomingSide == -1)
    #expect(layout.incoming?.x == -width + 120)
  }

  @Test func reduceMotionOnlyCrossfades() {
    let layout = PagerPhysics.layout(offset: -width * 0.4, width: width, hasLeft: true, hasRight: true, reduceMotion: true)
    #expect(layout.outgoing == PagerCardPose())
    #expect(layout.incoming?.x == 0)
    #expect(abs((layout.incoming?.opacity ?? 0) - 0.4) < 0.0001)
  }
}

struct DeckHeaderMetricsTests {
  @Test func titleRevealIsContinuousAndMonotonic() {
    var last: CGFloat = -1
    for width in stride(from: CGFloat(0), through: 200, by: 0.5) {
      let reveal = DeckHeaderMetrics.titleReveal(width: width)
      #expect(reveal >= last)
      #expect(reveal - max(last, 0) <= 0.5 / (DeckHeaderMetrics.titleShown - DeckHeaderMetrics.titleHidden) + 0.0001)
      last = reveal
    }
    #expect(DeckHeaderMetrics.titleReveal(width: 40) == 0)
    #expect(DeckHeaderMetrics.titleReveal(width: 120) == 1)
  }

  @Test func shortTitlesCenterAndLongOnesPinToTheLeadingEdge() {
    #expect(DeckHeaderMetrics.contentLeading(available: 200, icon: 16, spacing: 6, title: 78, reveal: 1) == 50)
    #expect(DeckHeaderMetrics.contentLeading(available: 200, icon: 16, spacing: 6, title: 400, reveal: 1) == 0)
  }

  @Test func leadingNeverJumpsAsTheStripNarrows() {
    var last: CGFloat?
    for available in stride(from: CGFloat(220), through: 10, by: -0.5) {
      let reveal = DeckHeaderMetrics.titleReveal(width: available)
      let leading = DeckHeaderMetrics.contentLeading(available: available, icon: 16, spacing: 6, title: 120, reveal: reveal)
      if let last { #expect(abs(leading - last) <= 2) }
      last = leading
    }
  }
}
