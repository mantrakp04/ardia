import ArdiaDesign
import SwiftUI

extension InterfaceStyleChoice {
  var title: LocalizedStringKey {
    switch self {
    case .matchMac: "Match My Mac"
    case .glass: "Glass"
    case .classic: "Classic"
    }
  }
}

extension ColorSchemeChoice {
  var title: LocalizedStringKey {
    switch self {
    case .matchMac: "Match My Mac"
    case .system: "System"
    case .light: "Light"
    case .dark: "Dark"
    }
  }
}
