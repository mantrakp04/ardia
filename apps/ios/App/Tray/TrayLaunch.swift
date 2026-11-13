import ArdiaDesign
import SwiftUI
import UIKit

enum TrayRest {
  case pageBar
  case floating
}

enum TrayKind {
  case search
  case pageMenu

  enum Height {
    case aboveKeyboard
    case fitsContent
  }

  var height: Height {
    switch self {
    case .search: .aboveKeyboard
    case .pageMenu: .fitsContent
    }
  }

  var fieldTrailingInset: CGFloat {
    switch self {
    case .search: BrowseLayout.searchFieldInset
    case .pageMenu: PageMenuTray.chevronReserve
    }
  }

  var fieldFade: TrayStageShare {
    switch self {
    case .search: .field
    case .pageMenu: .titleField
    }
  }

  var bodyFade: TrayStageShare? {
    switch self {
    case .search: .results
    case .pageMenu: nil
    }
  }

  var openTiming: TrayTiming {
    switch self {
    case .search: .open
    case .pageMenu: .grow
    }
  }

  var closeTiming: TrayTiming {
    switch self {
    case .search: .close
    case .pageMenu: .shrink
    }
  }

  var dismissLabel: String {
    switch self {
    case .search: String(localized: "Close Search")
    case .pageMenu: String(localized: "Close Menu")
    }
  }
}

struct TrayLaunch {
  let kind: TrayKind
  let rest: TrayRest
  let pill: CGRect
  let chevron: CGRect?
  let dims: Bool
  let focusesField: Bool
  let morphs: Bool
  let content: AnyView
  let sides: AnyView?
  let barBacking: AnyView?
}

struct TrayLook: Equatable {
  let panel: UIColor
  let style: UIUserInterfaceStyle
  let barStyle: UIUserInterfaceStyle
}

@MainActor
struct TrayContentLink {
  let kind: TrayKind
  weak var shell: TrayShellController?
  let progress: TrayProgress

  init(kind: TrayKind, shell: TrayShellController) {
    self.kind = kind
    self.shell = shell
    progress = shell.progress
  }

  func report(field: CGRect, contentTop: CGFloat) {
    shell?.reportContent(kind, fieldFrame: field, contentTop: contentTop)
  }

  var dismissDrag: some Gesture {
    DragGesture(minimumDistance: 6, coordinateSpace: .global)
      .onChanged { value in shell?.dragChanged(translation: value.translation.height) }
      .onEnded { value in shell?.dragEnded(translation: value.translation.height, velocity: value.velocity.height) }
  }
}
