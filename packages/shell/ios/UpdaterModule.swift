import ExpoModulesCore

public class UpdaterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaUpdater")

    Events("onReadyUpdate")

    OnCreate { [weak self] in
      DispatchQueue.main.async {
        AppUpdater.shared.onReadyUpdateChange = { ready in self?.sendEvent("onReadyUpdate", ["ready": ready as Any]) }
        AppUpdater.shared.start()
      }
    }

    AsyncFunction("updaterState") { () -> [String: Any] in AppUpdater.shared.state }.runOnQueue(.main)
    AsyncFunction("checkForUpdates") { AppUpdater.shared.checkForUpdates(nil) }.runOnQueue(.main)
    AsyncFunction("restartToUpdate") { AppUpdater.shared.restartToUpdate(nil) }.runOnQueue(.main)
    AsyncFunction("setAutomaticUpdateChecks") { (on: Bool) in AppUpdater.shared.setAutomaticChecks(on) }.runOnQueue(.main)
    AsyncFunction("setAutomaticUpdateDownloads") { (on: Bool) in AppUpdater.shared.setAutomaticDownloads(on) }.runOnQueue(.main)
    AsyncFunction("setUpdateChannel") { (channel: UpdateChannel) in AppUpdater.shared.setChannel(channel) }.runOnQueue(.main)
  }
}
