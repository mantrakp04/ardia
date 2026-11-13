import ArdiaDesign
import SwiftUI
import Testing

struct BottomBarGeometryTests {
  static let iPhone = CGSize(width: 402, height: 874)
  static let iPhoneSafe = EdgeInsets(top: 62, leading: 0, bottom: 34, trailing: 0)
  static let iPhoneCorners = RectangleCornerRadii(uniform: 62)
  static let duoClosed = CGSize(width: 466, height: 678)
  static let duoCorners = RectangleCornerRadii(topLeading: 8, bottomLeading: 8, bottomTrailing: 59, topTrailing: 59)

  static func approx(_ value: CGFloat, _ expected: CGFloat) -> Bool {
    abs(value - expected) < 0.001
  }

  @Test func `the phone bar floats 12 points from the sides above the home indicator`() {
    let bar = BottomBarGeometry(container: Self.iPhone, safeArea: Self.iPhoneSafe, corners: Self.iPhoneCorners, occlusions: [], verticalEdge: nil)
    #expect(bar.axis == .horizontal)
    #expect(Self.approx(bar.barFrame.minX, 12))
    #expect(Self.approx(bar.barFrame.maxX, 390))
    #expect(Self.approx(bar.barFrame.height, BarMetrics.pieceHeight))
    #expect(Self.approx(bar.barFrame.maxY, 874 - 22))
    #expect(Self.approx(bar.pageBottomInset, 22 + BarMetrics.pieceHeight + BarMetrics.pageGap))
    #expect(Self.approx(bar.pagerWidth, 402))
  }

  @Test func `the bar stays inside the screen's rounded corners`() {
    let corners = RectangleCornerRadii(uniform: 62)
    for sideGap in stride(from: CGFloat(0), through: 40, by: 4) {
      let gap = BottomBarGeometry.cornerClearance(radius: 62, sideGap: sideGap, pieceRadius: BarMetrics.pieceHeight / 2)
      let center = CGPoint(x: sideGap + BarMetrics.pieceHeight / 2, y: gap + BarMetrics.pieceHeight / 2)
      let distance = hypot(corners.bottomLeading - center.x, corners.bottomLeading - center.y)
      let insideSquare = center.x < corners.bottomLeading && center.y < corners.bottomLeading
      #expect(!insideSquare || distance + BarMetrics.pieceHeight / 2 <= corners.bottomLeading - BarMetrics.cornerMargin + 0.01)
    }
  }

  @Test func `a window with no safe area and square corners keeps a small margin`() {
    let bar = BottomBarGeometry(container: CGSize(width: 466, height: 678), safeArea: EdgeInsets(), corners: RectangleCornerRadii(uniform: 0), occlusions: [], verticalEdge: nil)
    #expect(Self.approx(bar.barFrame.maxY, 678 - BarMetrics.sideInset))
    #expect(Self.approx(bar.barFrame.minX, BarMetrics.sideInset))
    #expect(Self.approx(bar.pageBottomInset, BarMetrics.sideInset + BarMetrics.pieceHeight + BarMetrics.pageGap))
  }

  @Test func `landscape keeps the bar inside the safe area and at a readable width`() {
    let container = CGSize(width: 874, height: 402)
    let safe = EdgeInsets(top: 0, leading: 62, bottom: 21, trailing: 62)
    let bar = BottomBarGeometry(container: container, safeArea: safe, corners: Self.iPhoneCorners, occlusions: [], verticalEdge: nil)
    #expect(bar.isLandscape)
    #expect(Self.approx(bar.barFrame.width, BarMetrics.maxWidth))
    #expect(Self.approx(bar.barFrame.midX, 437))
    #expect(bar.barFrame.minX >= 62)
  }

  @Test func `the Duo's status cluster at the top does not narrow the bar at the bottom`() {
    let safe = EdgeInsets(top: 0, leading: 0, bottom: 20, trailing: 28)
    let cluster = CGRect(x: 438, y: 20, width: 28, height: 90)
    let bar = BottomBarGeometry(container: Self.duoClosed, safeArea: safe, corners: Self.duoCorners, occlusions: [cluster], verticalEdge: nil)
    #expect(Self.approx(bar.barFrame.minX, BarMetrics.sideInset))
    #expect(Self.approx(bar.barFrame.maxX, 466 - BarMetrics.sideInset))
    let clearance = BottomBarGeometry.cornerClearance(radius: 59, sideGap: BarMetrics.sideInset, pieceRadius: BarMetrics.pieceHeight / 2)
    #expect(abs(bar.barFrame.maxY - (678 - max(20 - BarMetrics.homeIndicatorShare, clearance, BarMetrics.cornerMargin))) < 0.001)
  }

  @Test func `an occlusion beside the bar pushes both sides in so the bar stays centred`() {
    let safe = EdgeInsets(top: 0, leading: 0, bottom: 20, trailing: 0)
    let camera = CGRect(x: 436, y: 600, width: 30, height: 60)
    let bar = BottomBarGeometry(container: Self.duoClosed, safeArea: safe, corners: RectangleCornerRadii(uniform: 8), occlusions: [camera], verticalEdge: nil)
    #expect(Self.approx(bar.barFrame.minX, 466 - 436 + BarMetrics.sideInset))
    #expect(Self.approx(bar.barFrame.maxX, 436 - BarMetrics.sideInset))
    #expect(Self.approx(bar.barFrame.midX, 233))
  }

  @Test func `without reserved areas the larger side inset applies to both sides, centring the bar on the Duo`() {
    let safe = EdgeInsets(top: 0, leading: 0, bottom: 20, trailing: 84)
    let bar = BottomBarGeometry(container: Self.duoClosed, safeArea: safe, corners: Self.duoCorners, occlusions: [], verticalEdge: nil)
    #expect(Self.approx(bar.barFrame.minX, 84))
    #expect(Self.approx(bar.barFrame.maxX, 466 - 84))
    #expect(Self.approx(bar.barFrame.midX, 233))
    #expect(Self.approx(bar.compactFrame.midX, 233))
    let open = BottomBarGeometry(container: CGSize(width: 951, height: 669), safeArea: safe, corners: RectangleCornerRadii(uniform: 55), occlusions: [], verticalEdge: nil)
    #expect(Self.approx(open.barFrame.midX, 951.0 / 2))
  }

  @Test func `a vertical bar edge turns the bar into a rail and keeps the page beside it`() {
    let safe = EdgeInsets(top: 0, leading: 0, bottom: 20, trailing: 28)
    let rail = BottomBarGeometry(container: Self.duoClosed, safeArea: safe, corners: Self.duoCorners, occlusions: [], verticalEdge: .trailing)
    #expect(rail.axis == .vertical(.trailing))
    #expect(Self.approx(rail.barFrame.maxX, 466 - 28))
    #expect(Self.approx(rail.barFrame.width, BarMetrics.pieceHeight))
    #expect(Self.approx(rail.pageBottomInset, 0))
    #expect(Self.approx(rail.pageTrailingInset, 28 + BarMetrics.pieceHeight + BarMetrics.pageGap))
    #expect(Self.approx(rail.pageLeadingInset, 0))
    #expect(Self.approx(rail.pagerWidth, 466 - (28 + BarMetrics.pieceHeight + BarMetrics.pageGap)))
    #expect(abs(rail.barFrame.midY - (678 - 20) / 2) < 0.5)
  }

  @Test func `the compact capsule sits centred on the bar's bottom edge`() {
    let bar = BottomBarGeometry(container: Self.iPhone, safeArea: Self.iPhoneSafe, corners: Self.iPhoneCorners, occlusions: [], verticalEdge: nil)
    #expect(Self.approx(bar.compactFrame.midX, bar.barFrame.midX))
    #expect(Self.approx(bar.compactFrame.maxY, bar.barFrame.maxY))
    #expect(Self.approx(bar.compactFrame.height, BarMetrics.compactHeight))
    #expect(bar.compactFrame.width <= BarMetrics.compactMaxWidth)
  }

  @Test func `side clearance ignores occlusions outside the band`() {
    let insets = SideClearance.insets(containerWidth: 466, safeArea: EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 28), occlusions: [CGRect(x: 438, y: 0, width: 28, height: 120)], band: 300...600, base: 0)
    #expect(insets == SideInsets(leading: 0, trailing: 0))
    let fallback = SideClearance.insets(containerWidth: 466, safeArea: EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 28), occlusions: [], band: 300...600, base: 0)
    #expect(fallback == SideInsets(leading: 0, trailing: 28))
  }
}
