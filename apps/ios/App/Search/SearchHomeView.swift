import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SearchHomeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    ZStack {
      backdrop
        .ignoresSafeArea()
      SearchSheet(style: .home, initialText: app.browse.search?.initialText ?? "", selectsAll: false) {
        FidgetLogo()
          .frame(width: BrowseLayout.logoSize, height: BrowseLayout.logoSize * 0.82)
          .padding(.bottom, Spacing.tight)
      }
    }
    .preferredColorScheme(app.isIncognito ? .dark : nil)
  }

  @ViewBuilder
  private var backdrop: some View {
    if app.isIncognito {
      LaunchGradient(colors: [Color(hex: 0x16161C), Color(hex: 0x24222E), Color(hex: 0x30283A), Color(hex: 0x3A2A3C)])
    } else {
      LaunchGradient(colors: themeColors)
    }
  }

  private var themeColors: [Color] {
    guard app.sync.isEnabled, let theme = app.sync.selectedProfile?.theme else { return Palette.launchGradient }
    let source = colorScheme == .dark ? (theme.darkColors ?? theme.colors) : theme.colors
    let colors = source.compactMap(Color.init(hexString:))
    return colors.count >= 2 ? colors : Palette.launchGradient
  }
}

#Preview("Start") {
  SearchHomeView()
    .environment(AppModel(isDemo: true))
}
