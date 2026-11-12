import ArdiaDesign
import ArdiaSync

extension AppModel {
  var look: ProfileLook {
    if let preset = settings.colorChoice.flatMap(ProfileLook.Preset.init(rawValue:)) { return ProfileLook(preset: preset) }
    return sync.isEnabled ? ProfileLook(profile: sync.selectedProfile) : .plum
  }
}
