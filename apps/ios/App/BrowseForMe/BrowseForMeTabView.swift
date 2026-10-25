import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct BrowseForMeTabView: View {
  let tabID: UUID

  @Environment(AppModel.self) private var app
  @State private var browse: BrowseForMe?

  init(tabID: UUID) {
    self.tabID = tabID
  }

  var body: some View {
    ZStack {
      if let browse {
        BrowseForMePage(
          browse: browse,
          engineName: app.searchEngineName,
          actions: BrowseForMePage.Actions(
            open: { app.openFromBrowseForMe($0) },
            search: { app.searchTheWeb($0) },
            ask: { app.browseForMe($0) },
            editQuery: { app.browse.presentSearch(from: .page, text: $0, selectsAll: true) },
            finished: { app.saveBrowsePage($0, forTab: tabID) },
            openExperiments: { app.openSettings(at: .experiments) }))
      } else {
        DriftingMesh(isAnimating: false)
      }
    }
    .onAppear {
      browse = app.browseForMe(forTab: tabID)
    }
    .onChange(of: tabID) {
      browse = app.browseForMe(forTab: tabID)
    }
  }
}
