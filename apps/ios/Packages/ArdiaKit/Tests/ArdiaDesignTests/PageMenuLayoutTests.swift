import ArdiaDesign
import Testing

struct PageMenuLayoutTests {
  @Test func `the Reader, Copy Link and Share tiles are as tall as the buttons in the row above them`() {
    #expect(PageMenuLayout.tileHeight == GlassMetrics.hitTarget)
    #expect(PageMenuLayout.tileHeight == GlassControlShape.capsule.minimumSize.height)
  }

  @Test func `the tiles are shorter than a list row, so they read as controls and not as rows`() {
    #expect(PageMenuLayout.tileHeight < PageMenuLayout.rowHeight)
  }
}
