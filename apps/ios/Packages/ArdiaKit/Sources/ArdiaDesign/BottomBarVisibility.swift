public struct BottomBarVisibility: Equatable, Sendable {
  public enum FindPhase: Equatable, Sendable {
    case idle
    case finding
    case leaving
  }

  public enum Presentation: Equatable, Sendable {
    case expanded
    case collapsed
    case hidden
  }

  public var scrollCollapsed = false
  public private(set) var findPhase = FindPhase.idle
  public private(set) var keyboardVisible = false

  public init() {}

  public var presentation: Presentation {
    if findPhase != .idle { return .hidden }
    return scrollCollapsed ? .collapsed : .expanded
  }

  public func presentation(searchTrayPresented: Bool) -> Presentation {
    searchTrayPresented ? .hidden : presentation
  }

  public var isShown: Bool {
    presentation != .hidden
  }

  public mutating func scrolled(down: Bool, collapses: Bool) {
    scrollCollapsed = collapses && down
  }

  public mutating func expand() {
    scrollCollapsed = false
  }

  public mutating func findSessionChanged(isActive: Bool) {
    if isActive {
      findPhase = .finding
    } else if findPhase == .finding {
      findPhase = keyboardVisible ? .leaving : .idle
    }
  }

  public mutating func keyboardWillShow() {
    keyboardVisible = true
  }

  public mutating func keyboardDidHide() {
    keyboardVisible = false
    if findPhase == .leaving {
      findPhase = .idle
    }
  }
}
