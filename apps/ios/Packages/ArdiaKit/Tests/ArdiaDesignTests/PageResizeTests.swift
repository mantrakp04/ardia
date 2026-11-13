import ArdiaDesign
import SwiftUI
import Testing

struct PageResizeTests {
  @Test func `only a real width change on a laid out page is covered`() {
    #expect(PageResize.coversChange(from: CGSize(width: 1012, height: 1300), to: CGSize(width: 742, height: 1300)))
    #expect(PageResize.coversChange(from: CGSize(width: 742, height: 1300), to: CGSize(width: 742.6, height: 1300)))
    #expect(!PageResize.coversChange(from: CGSize(width: 742, height: 1300), to: CGSize(width: 742.2, height: 1300)))
    #expect(!PageResize.coversChange(from: CGSize(width: 742, height: 1300), to: CGSize(width: 742, height: 900)))
    #expect(!PageResize.coversChange(from: .zero, to: CGSize(width: 742, height: 1300)))
    #expect(!PageResize.coversChange(from: CGSize(width: 742, height: 1300), to: .zero))
  }

  @Test func `a page WebKit shrinks to fit scales with the card, a page that reflows does not`() {
    #expect(PageResize.scalesWithCard(minimumZoomScale: 0.76))
    #expect(!PageResize.scalesWithCard(minimumZoomScale: 1))
    #expect(!PageResize.scalesWithCard(minimumZoomScale: 0.995))
    let base = CGSize(width: 742, height: 1300)
    let wider = CGSize(width: 1012, height: 1300)
    #expect(PageResize.coverScale(from: base, to: wider, scalesWithCard: false) == 1)
    #expect(abs(PageResize.coverScale(from: base, to: wider, scalesWithCard: true) - 1012 / 742) < 0.0001)
  }

  @Test func `a scaling cover always fills the card from the top leading corner`() {
    let base = CGSize(width: 742, height: 1300)
    #expect(PageResize.coverScale(from: base, to: CGSize(width: 600, height: 1300), scalesWithCard: true) == 1)
    #expect(abs(PageResize.coverScale(from: CGSize(width: 1300, height: 742), to: CGSize(width: 742, height: 1300), scalesWithCard: true) - 1300 / 742) < 0.0001)
    #expect(PageResize.coverScale(from: .zero, to: base, scalesWithCard: true) == 1)
    for width in stride(from: CGFloat(400), through: 1400, by: 50) {
      let size = CGSize(width: width, height: 1300)
      let scale = PageResize.coverScale(from: base, to: size, scalesWithCard: true)
      #expect(base.width * scale >= size.width - 0.001)
      #expect(base.height * scale >= size.height - 0.001)
    }
  }

  @Test func `with Reduce Motion the cover never zooms`() {
    let base = CGSize(width: 742, height: 1300)
    #expect(PageResize.coverScale(from: base, to: CGSize(width: 1012, height: 1300), scalesWithCard: true, reduceMotion: true) == 1)
  }

  @Test func `the page is ready once its content matches the new width`() {
    #expect(PageResize.hasLaidOut(contentWidth: 1012, viewWidth: 1012))
    #expect(PageResize.hasLaidOut(contentWidth: 1011.4, viewWidth: 1012))
    #expect(!PageResize.hasLaidOut(contentWidth: 742, viewWidth: 1012))
    #expect(!PageResize.hasLaidOut(contentWidth: 0, viewWidth: 0))
    #expect(PageResize.hasRelaidOut(contentWidth: 1300, startWidth: 1100))
    #expect(!PageResize.hasRelaidOut(contentWidth: 1100.5, startWidth: 1100))
  }

  @Test func `small layout noise does not restart the settle wait`() {
    #expect(PageResize.isStill(from: CGSize(width: 742, height: 1300), to: CGSize(width: 742.3, height: 1300.2)))
    #expect(!PageResize.isStill(from: CGSize(width: 742, height: 1300), to: CGSize(width: 744, height: 1300)))
    #expect(!PageResize.isStill(from: CGSize(width: 742, height: 1300), to: CGSize(width: 742, height: 1290)))
  }

  @Test func `a page counts as at its top within a point of the top inset`() {
    #expect(PageInsets.isAtTop(offsetY: -64, adjustedTop: 64))
    #expect(PageInsets.isAtTop(offsetY: -63.5, adjustedTop: 64))
    #expect(!PageInsets.isAtTop(offsetY: 0, adjustedTop: 64))
    #expect(PageInsets.isAtTop(offsetY: 0, adjustedTop: 0))
  }

  @Test func `WebKit is told the status bar, the card's controls and the bar as obscured insets`() {
    let phone = PageInsets.obscured(safeTop: 62, topInset: 0, bottomInset: 78)
    #expect(phone.top == 62)
    #expect(phone.bottom == 78)
    #expect(phone.leading == 0)
    #expect(phone.trailing == 0)
    let card = PageInsets.obscured(safeTop: 0, topInset: 64, bottomInset: 0)
    #expect(card.top == 64)
    #expect(card.bottom == 0)
    #expect(PageInsets.obscured(safeTop: -1, topInset: -5, bottomInset: -3) == EdgeInsets())
  }

  @Test func `the cover always has a deadline, even while it waits to reveal`() {
    #expect(PageResize.revealDeadline > 0)
    #expect(PageResize.revealDeadline < PageResize.paintDeadline)
  }
}
