public struct BottomBarVisibility: Equatable, Sendable {
  public enum FindPhase: Equatable, Sendable {
    case idle
    case finding
    case leaving
  }

  public var scrollCollapsed = false
  public private(set) var findPhase = FindPhase.idle
  public private(set) var keyboardVisible = false

  public init() {}

  public var isShown: Bool {
    !scrollCollapsed && findPhase == .idle
  }

  public func isShown(searchTrayPresented: Bool) -> Bool {
    isShown && !searchTrayPresented
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
