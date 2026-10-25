import Foundation

extension AppModel {
  var offersBrowseForMe: Bool { isBrowseForMeAvailable }
  var offersSummaries: Bool { isSummaryAvailable }
  var offersPinchToSummarize: Bool { isSummaryAvailable }
}
