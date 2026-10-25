import SwiftUI
import WidgetKit

@main
struct ArdiaWidgets: WidgetBundle {
  var body: some Widget {
    SearchWidget()
    MacTabsWidget()
    SearchLockScreenWidget()
    SearchLockScreenRectangularWidget()
    VoiceSearchLockScreenWidget()
    SearchControl()
    VoiceSearchControl()
    IncognitoTabControl()
  }
}
