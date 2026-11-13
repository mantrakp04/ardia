import Foundation
import Observation

@MainActor
@Observable
final class BrowseSession {
  enum SearchOrigin: Equatable {
    case home
    case start
    case page
  }

  struct SearchRequest: Equatable {
    var origin: SearchOrigin
    var initialText: String
    var selectsAll: Bool
    var incognitoOnCancel: Bool?
  }

  var search: SearchRequest?
  var trayHoldsKeyboard = false
  var trayOwnsPlus = false
  var trayCoversPageBar = false
  var pagePlusFrame = CGRect.zero
  var floatingPlusFrame = CGRect.zero
  var pageChevronFrame = CGRect.zero
  var isToolbarPresented = false
  var readerTabID: UUID?
  var titleFeedback: String?
  var isVoicePresented = false
  var desktopTabs: Set<UUID> = []
  var stepRequest: StepRequest?
  var deckRequested = false
  var tones: [UUID: PageTone] = [:]

  var isSearchTrayOnScreen: Bool {
    search != nil || trayHoldsKeyboard
  }

  func pageBarGrowsIntoTray(reduceMotion: Bool) -> Bool {
    !reduceMotion && (trayCoversPageBar || search?.origin == .page)
  }

  struct StepRequest: Equatable {
    let id = UUID()
    let delta: Int
  }

  @ObservationIgnored let covers = PageCoverCache()
  @ObservationIgnored private(set) var frozenOrder: [UUID]?
  @ObservationIgnored private var unfreezeTask: Task<Void, Never>?
  static let orderFreeze: Duration = .seconds(4)
  @ObservationIgnored private var feedbackTask: Task<Void, Never>?

  func presentSearch(from origin: SearchOrigin, text: String = "", selectsAll: Bool = false, incognitoOnCancel: Bool? = nil) {
    guard search == nil else { return }
    search = SearchRequest(origin: origin, initialText: text, selectsAll: selectsAll, incognitoOnCancel: incognitoOnCancel)
  }

  func freezeOrder(_ ids: [UUID]) {
    if frozenOrder == nil { frozenOrder = ids }
    unfreezeTask?.cancel()
    unfreezeTask = Task { [weak self] in
      try? await Task.sleep(for: Self.orderFreeze)
      guard !Task.isCancelled else { return }
      self?.frozenOrder = nil
    }
  }

  func thawOrder() {
    unfreezeTask?.cancel()
    unfreezeTask = nil
    frozenOrder = nil
  }

  func setTone(_ tone: PageTone, for id: UUID) {
    guard tones[id] != tone else { return }
    tones[id] = tone
  }

  func dismissSearch() {
    search = nil
  }

  func showTitleFeedback(_ text: String, for duration: Duration = .seconds(1)) {
    feedbackTask?.cancel()
    titleFeedback = text
    feedbackTask = Task { [weak self] in
      try? await Task.sleep(for: duration)
      guard !Task.isCancelled else { return }
      self?.titleFeedback = nil
    }
  }
}
