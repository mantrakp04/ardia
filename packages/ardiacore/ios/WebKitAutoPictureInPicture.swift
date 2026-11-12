struct WebKitAutoPictureInPicture {
  enum Action: Equatable {
    case none
    case open
    case close
  }

  private(set) var seen = true
  private(set) var autoOpened = false
  private(set) var reportedActive = false

  mutating func sight(_ nowSeen: Bool, enabled: Bool, playing: Bool) -> Action {
    guard nowSeen != seen else { return .none }
    seen = nowSeen
    if !nowSeen {
      guard enabled, playing else { return .none }
      autoOpened = true
      return .open
    }
    guard autoOpened || reportedActive else { return .none }
    autoOpened = false
    return .close
  }

  mutating func reported(active: Bool) {
    if !active && reportedActive { autoOpened = false }
    reportedActive = active
  }
}
