import ArdiaDesign
import CoreGraphics
import Testing

struct SettingsLayoutTests {
  @Test func `phones and the Duo's closed display get no extra margin`() {
    #expect(SettingsLayout.columnMargin(forWidth: 402) == 0)
    #expect(SettingsLayout.columnMargin(forWidth: 466) == 0)
    #expect(SettingsLayout.columnMargin(forWidth: 0) == 0)
  }

  @Test func `a window as wide as the column gets no margin`() {
    #expect(SettingsLayout.columnMargin(forWidth: SettingsLayout.readableWidth) == 0)
  }

  @Test func `wider windows centre the column`() {
    let width = SettingsLayout.readableWidth
    #expect(SettingsLayout.columnMargin(forWidth: width + 100) == 50)
    #expect(SettingsLayout.columnMargin(forWidth: 1032) == (1032 - width) / 2)
  }

  @Test func `the column and its margins always add up to the window`() {
    for window in stride(from: CGFloat(300), through: 1400, by: 37) {
      let margin = SettingsLayout.columnMargin(forWidth: window)
      #expect(window - 2 * margin <= max(window, SettingsLayout.readableWidth))
      #expect(window - 2 * margin >= min(window, SettingsLayout.readableWidth) - 0.001)
    }
  }

  @Test func `narrow windows keep the list's own side margin and never lose it`() {
    for window in [CGFloat(0), 320, 402, 466, 600, 640, SettingsLayout.readableWidth + 2 * SettingsLayout.minimumSideMargin] {
      #expect(SettingsLayout.contentMargin(forWidth: window) == SettingsLayout.minimumSideMargin, "\(window)")
    }
  }

  @Test func `wide windows use the margin that centres the column`() {
    #expect(SettingsLayout.contentMargin(forWidth: 1032) == SettingsLayout.columnMargin(forWidth: 1032))
    #expect(SettingsLayout.contentMargin(forWidth: 1376) == (1376 - SettingsLayout.readableWidth) / 2)
  }

  @Test func `the content margin is never below the minimum and grows with the window`() {
    var previous: CGFloat = 0
    for window in stride(from: CGFloat(300), through: 1500, by: 41) {
      let margin = SettingsLayout.contentMargin(forWidth: window)
      #expect(margin >= SettingsLayout.minimumSideMargin)
      #expect(margin >= previous)
      previous = margin
    }
  }

  @Test func `a safe-area inset is kept clear and the normal margin is added after it`() {
    let inset: CGFloat = 83
    #expect(SettingsLayout.contentMargin(forWidth: 466, safeInset: inset) == inset + SettingsLayout.minimumSideMargin)
    #expect(SettingsLayout.contentMargin(forWidth: 466, safeInset: 0) == SettingsLayout.minimumSideMargin)
  }

  @Test func `each side takes its own inset so the hinge side keeps only the normal margin`() {
    let leading = SettingsLayout.contentMargin(forWidth: 466, safeInset: 0)
    let trailing = SettingsLayout.contentMargin(forWidth: 466, safeInset: 83)
    #expect(leading == SettingsLayout.minimumSideMargin)
    #expect(trailing > leading)
  }

  @Test func `a wide window keeps the column unless the inset needs more`() {
    #expect(SettingsLayout.contentMargin(forWidth: 1032, safeInset: 20) == SettingsLayout.columnMargin(forWidth: 1032))
    #expect(SettingsLayout.contentMargin(forWidth: 700, safeInset: 83) == 83 + SettingsLayout.minimumSideMargin)
  }

  @Test func `a negative inset never shrinks the margin`() {
    #expect(SettingsLayout.contentMargin(forWidth: 402, safeInset: -10) == SettingsLayout.minimumSideMargin)
  }
}
