import ArdiaDesign
import Testing

struct BottomBarVisibilityTests {
  @Test func `the bar is shown when nothing hides it`() {
    let visibility = BottomBarVisibility()
    #expect(visibility.isShown)
  }

  @Test func `scrolling down collapses the bar and scrolling back restores it`() {
    var visibility = BottomBarVisibility()
    visibility.scrollCollapsed = true
    #expect(!visibility.isShown)
    visibility.scrollCollapsed = false
    #expect(visibility.isShown)
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

  @Test func `a collapsed bar stays hidden after find ends`() {
    var visibility = BottomBarVisibility()
    visibility.scrollCollapsed = true
    visibility.findSessionChanged(isActive: true)
    visibility.findSessionChanged(isActive: false)
    #expect(!visibility.isShown)
  }

  @Test func `the bar is hidden while the search tray is on screen`() {
    let visibility = BottomBarVisibility()
    #expect(visibility.isShown(searchTrayPresented: false))
    #expect(!visibility.isShown(searchTrayPresented: true))
  }

  @Test func `the search tray leaving does not bring back a bar find still hides`() {
    var visibility = BottomBarVisibility()
    visibility.findSessionChanged(isActive: true)
    #expect(!visibility.isShown(searchTrayPresented: false))
  }

  @Test func `the search tray leaving does not bring back a collapsed bar`() {
    var visibility = BottomBarVisibility()
    visibility.scrollCollapsed = true
    #expect(!visibility.isShown(searchTrayPresented: false))
  }

  @Test func `a keyboard cycle with no find session never hides the bar`() {
    var visibility = BottomBarVisibility()
    visibility.keyboardWillShow()
    #expect(visibility.isShown)
    visibility.keyboardDidHide()
    #expect(visibility.isShown)
  }
}
