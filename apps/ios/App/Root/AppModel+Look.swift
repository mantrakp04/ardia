import ArdiaDesign
import ArdiaSync
import SwiftUI

extension AppModel {
  var look: ProfileLook {
    if let preset = settings.colorChoice.flatMap(ProfileLook.Preset.init(rawValue:)) { return ProfileLook(preset: preset) }
    return sync.isEnabled ? ProfileLook(profile: sync.selectedProfile) : .plum
  }

  var macLook: SyncedLook? {
    sync.isEnabled ? sync.snapshot.look : nil
  }

  var resolvedInterfaceStyle: InterfaceStyle {
    switch settings.interfaceStyle {
    case .matchMac: macLook?.interfaceStyle == .classic ? .classic : .glass
    case let chosen: chosen
    }
  }

  func usesGlass(reduceTransparency: Bool) -> Bool {
    !reduceTransparency && resolvedInterfaceStyle == .glass
  }

  var preferredScheme: ColorScheme? {
    guard settings.schemeChoice == .matchMac else { return settings.schemeChoice.colorScheme }
    return switch macLook?.appearance {
    case .light: .light
    case .dark: .dark
    case .auto, nil: nil
    }
  }
}
