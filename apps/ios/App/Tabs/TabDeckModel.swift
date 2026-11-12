import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class TabDeckModel {
  struct Handoff {
    var tabID: UUID
    var image: UIImage
  }

  enum Entrance: Equatable {
    case fromPage(UUID)
    case plain
  }

  static let archiveCardKey = "tabs.archiveCardShown"
  static let archiveCardThreshold = 8

  struct Command: Equatable {
    enum Kind: Equatable {
      case scroll(Int)
      case closeFocused
      case openFocused
      case showArchiveCard
      case lift(Double)
    }

    let id = UUID()
    var kind: Kind
  }

  var handoff: Handoff?
  var entrance: Entrance = .plain
  var command: Command?
  @ObservationIgnored private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  var hasShownArchiveCard: Bool {
    get { defaults.bool(forKey: Self.archiveCardKey) }
    set { defaults.set(newValue, forKey: Self.archiveCardKey) }
  }

  func shouldOfferArchiveCard(openTabs: Int) -> Bool {
    !hasShownArchiveCard && openTabs >= Self.archiveCardThreshold
  }

  func memoryImage(for id: UUID) -> UIImage? {
    guard let handoff, handoff.tabID == id else { return nil }
    return handoff.image
  }

  func forget(_ ids: Set<UUID>) {
    if let handoff, ids.contains(handoff.tabID) { self.handoff = nil }
  }
}
