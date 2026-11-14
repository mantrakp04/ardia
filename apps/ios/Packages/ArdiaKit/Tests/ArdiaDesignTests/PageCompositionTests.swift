import ArdiaDesign
import CoreGraphics
import Testing

struct PageCompositionTests {
  @Test func `phones and the Duo's closed display stack the page`() {
    #expect(PageComposition(size: CGSize(width: 402, height: 874)) == .stacked)
    #expect(PageComposition(size: CGSize(width: 466, height: 678)) == .stacked)
    #expect(PageComposition(size: CGSize(width: 599, height: 951)) == .stacked)
  }

  @Test func `the Duo open and a portrait iPad get a centred column`() {
    #expect(PageComposition(size: CGSize(width: 669, height: 951)) == .column)
    #expect(PageComposition(size: CGSize(width: 744, height: 1133)) == .column)
    #expect(PageComposition(size: CGSize(width: 1032, height: 1376)) == .column)
  }

  @Test func `wide short windows put the illustration beside the copy`() {
    #expect(PageComposition(size: CGSize(width: 1376, height: 1032)) == .sideBySide)
    #expect(PageComposition(size: CGSize(width: 951, height: 669)) == .sideBySide)
    #expect(PageComposition(size: CGSize(width: 874, height: 402)) == .sideBySide)
    #expect(PageComposition(size: CGSize(width: 678, height: 466)) == .sideBySide)
  }

  @Test func `a square window is a column and the width threshold is 600`() {
    #expect(PageComposition(size: CGSize(width: 800, height: 800)) == .column)
    #expect(PageComposition(size: CGSize(width: 600, height: 900)) == .column)
    #expect(PageComposition(size: CGSize(width: 599.5, height: 300)) == .stacked)
  }

  @Test func `the column is narrower than the Duo's open display`() {
    #expect(PageComposition.columnWidth < 669)
    #expect(PageComposition.sideBySideCopyWidth < PageComposition.columnWidth)
  }
}
