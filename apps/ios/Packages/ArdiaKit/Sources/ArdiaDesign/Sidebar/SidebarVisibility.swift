public enum SidebarPlacement: String, Equatable, Sendable {
  case none
  case docked
  case hidden
  case peek
  case overlay
  case foldSplit

  public var showsHostCapsule: Bool { self == .hidden || self == .peek }
  public var cardShowsSidebarToggle: Bool { self == .hidden || self == .peek }
  public var dimsPage: Bool { self == .overlay }
  public var sidebarBesidePage: Bool { self == .docked }
}

public enum SidebarToggleAction: String, Equatable, Sendable {
  case show
  case hide
  case pin
}

public enum SidebarPeekKind: String, Equatable, Sendable {
  case pointer
  case touch
}

public struct SidebarVisibility: Equatable, Sendable {
  public var hidesDocked: Bool
  public var isOverlayOpen: Bool
  public var peek: SidebarPeekKind?

  public init(hidesDocked: Bool = false, isOverlayOpen: Bool = false, peek: SidebarPeekKind? = nil) {
    self.hidesDocked = hidesDocked
    self.isOverlayOpen = isOverlayOpen
    self.peek = peek
  }

  public init(shownEverywhere shown: Bool) {
    self.init(hidesDocked: !shown, isOverlayOpen: shown)
  }

  public static func restsHidden(in layout: ChromeLayout) -> Bool {
    layout != .sidebarDocked
  }

  public static func canToggle(layout: ChromeLayout, hinge: HingeState?) -> Bool {
    layout.hasSidebar && hinge != .partial
  }

  public func placement(layout: ChromeLayout, hinge: HingeState?) -> SidebarPlacement {
    guard layout.hasSidebar else { return .none }
    if hinge == .partial { return .foldSplit }
    switch layout {
    case .sidebarDocked: return hidesDocked ? peekPlacement : .docked
    case .sidebarOverlay: return isOverlayOpen ? .overlay : peekPlacement
    case .bar: return .none
    }
  }

  private var peekPlacement: SidebarPlacement {
    switch peek {
    case .pointer: .peek
    case .touch: .overlay
    case nil: .hidden
    }
  }

  public func peeking(_ kind: SidebarPeekKind, layout: ChromeLayout, hinge: HingeState?) -> SidebarVisibility {
    guard SidebarVisibility(hidesDocked: hidesDocked, isOverlayOpen: isOverlayOpen).placement(layout: layout, hinge: hinge) == .hidden else { return self }
    return SidebarVisibility(hidesDocked: hidesDocked, isOverlayOpen: isOverlayOpen, peek: kind)
  }

  public func endingPeek() -> SidebarVisibility {
    SidebarVisibility(hidesDocked: hidesDocked, isOverlayOpen: isOverlayOpen)
  }

  public func toggleAction(layout: ChromeLayout, hinge: HingeState?) -> SidebarToggleAction? {
    guard Self.canToggle(layout: layout, hinge: hinge) else { return nil }
    switch placement(layout: layout, hinge: hinge) {
    case .docked, .overlay: return .hide
    case .peek: return .pin
    case .hidden: return .show
    case .none, .foldSplit: return nil
    }
  }

  public func toggled(in layout: ChromeLayout) -> SidebarVisibility {
    if peek == .touch { return endingPeek() }
    if peek != nil {
      switch layout {
      case .sidebarDocked: return SidebarVisibility(hidesDocked: false)
      case .sidebarOverlay: return SidebarVisibility(hidesDocked: hidesDocked, isOverlayOpen: true)
      case .bar: return endingPeek()
      }
    }
    switch layout {
    case .sidebarDocked: return SidebarVisibility(hidesDocked: !hidesDocked, isOverlayOpen: false)
    case .sidebarOverlay: return SidebarVisibility(hidesDocked: hidesDocked, isOverlayOpen: !isOverlayOpen)
    case .bar: return self
    }
  }

  public func dismissingOverlay() -> SidebarVisibility {
    SidebarVisibility(hidesDocked: hidesDocked, isOverlayOpen: false, peek: peek == .pointer ? .pointer : nil)
  }

  public func adapting(to layout: ChromeLayout) -> SidebarVisibility {
    let settled = endingPeek()
    return layout == .sidebarOverlay ? settled : settled.dismissingOverlay()
  }
}
