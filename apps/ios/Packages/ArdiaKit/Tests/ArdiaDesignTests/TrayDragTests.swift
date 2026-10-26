import ArdiaDesign
import CoreGraphics
import Testing

struct TrayDragTests {
  @Test func `downward drags follow the finger exactly`() {
    #expect(TrayDrag.offset(for: 0) == 0)
    #expect(TrayDrag.offset(for: 84) == 84)
  }

  @Test func `upward drags resist and never pass the limit`() {
    let small = TrayDrag.offset(for: -10)
    let large = TrayDrag.offset(for: -400)
    #expect(small < 0 && small > -10)
    #expect(large < small)
    #expect(large > -TrayDrag.upwardLimit)
  }

  @Test func `a slow short drag springs back`() {
    #expect(!TrayDrag.shouldDismiss(translation: 40, velocity: 60, trayHeight: 274))
  }

  @Test func `a slow drag past the distance dismisses`() {
    let distance = TrayDrag.dismissDistance(trayHeight: 274)
    #expect(TrayDrag.shouldDismiss(translation: distance + 1, velocity: 0, trayHeight: 274))
  }

  @Test func `a flick down dismisses from a short distance`() {
    #expect(TrayDrag.shouldDismiss(translation: 14, velocity: 1200, trayHeight: 274))
  }

  @Test func `moving back up cancels even past the distance`() {
    #expect(!TrayDrag.shouldDismiss(translation: 200, velocity: -600, trayHeight: 274))
  }

  @Test func `an upward pull never dismisses`() {
    #expect(!TrayDrag.shouldDismiss(translation: -20, velocity: 1500, trayHeight: 274))
  }

  @Test func `a compact tray needs a proportionally shorter drag`() {
    #expect(TrayDrag.dismissDistance(trayHeight: 78) < TrayDrag.dismissDistance(trayHeight: 274))
    #expect(TrayDrag.dismissDistance(trayHeight: 2000) == TrayDrag.distanceCap)
  }

  @Test func `the keyboard waits for a deliberate pull`() {
    #expect(!TrayDrag.releasesKeyboard(translation: 3))
    #expect(!TrayDrag.releasesKeyboard(translation: -30))
    #expect(TrayDrag.releasesKeyboard(translation: 20))
  }

  @Test func `progress is clamped to the travel`() {
    #expect(TrayDrag.progress(offset: -10, travel: 300) == 0)
    #expect(TrayDrag.progress(offset: 150, travel: 300) == 0.5)
    #expect(TrayDrag.progress(offset: 900, travel: 300) == 1)
    #expect(TrayDrag.progress(offset: 50, travel: 0) == 0)
  }
}
