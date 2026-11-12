import ArdiaDesign
import ArdiaSync

extension AppModel {
  var look: ProfileLook {
    sync.isEnabled ? ProfileLook(profile: sync.selectedProfile) : .plum
  }
}
