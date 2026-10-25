import ArdiaIntelligence

extension AppModel {
  func openSettings(at route: SettingsRoute? = nil) {
    settings.pendingRoute = route
    sheet = .settings
  }

  var isBrowseForMeAvailable: Bool {
    settings.isBrowseForMeOn && intelligence.availability.isAvailable
  }

  var isSummaryAvailable: Bool {
    settings.isPinchToSummarizeOn && intelligence.availability.isAvailable
  }

  var isAskAvailable: Bool {
    settings.isAskAboutPageOn && intelligence.availability.isAvailable
  }
}
