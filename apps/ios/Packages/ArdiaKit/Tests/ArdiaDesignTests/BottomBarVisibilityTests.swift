import ArdiaDesign
import Testing

struct BottomBarVisibilityTests {
  @Test func `the bar is shown when nothing hides it`() {
    let visibility = BottomBarVisibility()
    #expect(visibility.isShown)
  }

  @Test func `scrolling down collapses the bar to the pill and scrolling back restores it`() {
    var visibility = BottomBarVisibility()
    visibility.scrolled(down: true, collapses: true)
    #expect(visibility.presentation == .collapsed)
    #expect(visibility.isShown)
    visibility.scrolled(down: false, collapses: true)
    #expect(visibility.presentation == .expanded)
  }

  @Test func `scrolling never collapses the bar when the setting is off`() {
    var visibility = BottomBarVisibility()
    visibility.scrolled(down: true, collapses: false)
    #expect(visibility.presentation == .expanded)
  }

  @Test func `tapping the pill expands the bar`() {
    var visibility = BottomBarVisibility()
    visibility.scrolled(down: true, collapses: true)
    visibility.expand()
    #expect(visibility.presentation == .expanded)
  }

  @Test func `the bar is hidden while a find session is active`() {
    var visibility = BottomBarVisibility()
    visibility.findSessionChanged(isActive: true)
    #expect(!visibility.isShown)
    #expect(visibility.findPhase == .finding)
  }

  @Test func `the bar stays hidden after find ends while the keyboard is still leaving`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    visibility.findSessionChanged(isActive: true)
    visibility.findSessionChanged(isActive: false)
    #expect(!visibility.isShown)
    #expect(visibility.findPhase == .leaving)
  }

  @Test func `the bar returns once the keyboard has finished hiding`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    visibility.findSessionChanged(isActive: true)
    visibility.findSessionChanged(isActive: false)
    visibility.keyboardDidHide()
    #expect(visibility.isShown)
    #expect(visibility.findPhase == .idle)
  }

  @Test func `the bar returns at once when find ends with no keyboard on screen`() {
    var visibility = BottomBarVisibility()
    visibility.findSessionChanged(isActive: true)
    visibility.findSessionChanged(isActive: false)
    #expect(visibility.isShown)
  }

  @Test func `a find session that starts while the panel is leaving keeps the bar hidden`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    visibility.findSessionChanged(isActive: true)
    visibility.findSessionChanged(isActive: false)
    visibility.findSessionChanged(isActive: true)
    visibility.keyboardDidHide()
    #expect(!visibility.isShown)
    #expect(visibility.findPhase == .finding)
  }

  @Test func `a keyboard that hides while find is active does not bring the bar back`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    visibility.findSessionChanged(isActive: true)
    visibility.keyboardDidHide()
    #expect(!visibility.isShown)
  }

  @Test func `ending a find that never began leaves the bar alone`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    visibility.findSessionChanged(isActive: false)
    #expect(visibility.isShown)
    #expect(visibility.findPhase == .idle)
  }

  @Test func `a collapsed bar comes back collapsed after find ends`() {
    var visibility = BottomBarVisibility()
    visibility.scrollCollapsed = true
    visibility.findSessionChanged(isActive: true)
    #expect(visibility.presentation == .hidden)
    visibility.findSessionChanged(isActive: false)
    #expect(visibility.presentation == .collapsed)
  }

  @Test func `the bar is hidden while the search tray is on screen`() {
    let visibility = BottomBarVisibility()
    #expect(visibility.presentation(searchTrayPresented: false) == .expanded)
    #expect(visibility.presentation(searchTrayPresented: true) == .hidden)
  }

  @Test func `the search tray leaving does not bring back a bar find still hides`() {
    var visibility = BottomBarVisibility()
    visibility.findSessionChanged(isActive: true)
    #expect(visibility.presentation(searchTrayPresented: false) == .hidden)
  }

  @Test func `the search tray leaving keeps a collapsed bar collapsed`() {
    var visibility = BottomBarVisibility()
    visibility.scrollCollapsed = true
    #expect(visibility.presentation(searchTrayPresented: false) == .collapsed)
  }

  @Test func `a keyboard cycle with no find session never hides the bar`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    #expect(visibility.isShown)
    visibility.keyboardDidHide()
    #expect(visibility.isShown)
  }
}
