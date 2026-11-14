import ArdiaDesign
import ArdiaSync

extension AppModel {
  var look: ProfileLook {
    if let preset = settings.colorChoice.flatMap(ProfileLook.Preset.init(rawValue:)) { return ProfileLook(preset: preset) }
    return sync.isEnabled ? ProfileLook(profile: sync.selectedProfile) : .plum
  }

  var appearance: ResolvedAppearance {
    AppearanceResolver.resolve(settings.appearanceChoices, mac: sync.snapshot.lookSettings, syncIsOn: sync.isEnabled)
  }
}
