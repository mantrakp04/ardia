import ExpoModulesCore

public class ExtensionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaExtensions")
    Events("onChanged", "onTabs", "onInstallPrompt")

    OnCreate {
      ArdiaCoreHost.extensionsEventHandler = { [weak self] name, payload in
        if name == "installPrompt" { self?.sendEvent("onInstallPrompt", payload) }
      }
      ArdiaCoreServices.extensionsHandler = { [weak self] name, payload in
        switch name {
        case "changed": self?.sendEvent("onChanged", payload)
        case "tabs": self?.sendEvent("onTabs", payload)
        case "installPrompt": self?.sendEvent("onInstallPrompt", payload)
        default: break
        }
      }
    }

    AsyncFunction("resolveInstallPrompt") { (requestId: String, accepted: Bool) in
      ArdiaCoreHost.resolveExtensionInstallPrompt(requestId, accepted: accepted)
    }.runOnQueue(.main)
    AsyncFunction("list") { (profile: String, promise: Promise) in
      ArdiaCoreServices.listExtensions(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("inspectUnpacked") { (path: String) in ArdiaCoreServices.inspectUnpacked(path) }.runOnQueue(.main)
    AsyncFunction("install") { (path: String, profile: String, promise: Promise) in
      ArdiaCoreServices.installExtension(path: path, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("installCrx") { (path: String, profile: String, promise: Promise) in
      ArdiaCoreServices.installCrx(path: path, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("installFromWebStore") { (id: String, profile: String, promise: Promise) in
      WebStoreDownload.crx(id: id) { path, error in
        guard let path else { return promise.resolve(["error": error ?? "The Chrome Web Store didn't send the extension."]) }
        ArdiaCoreServices.installCrx(path: path, profile: profile) { result in
          try? FileManager.default.removeItem(atPath: path)
          promise.resolve(result)
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("setEnabled") { (id: String, profile: String, enabled: Bool, promise: Promise) in
      ArdiaCoreServices.setExtension(id, enabled: enabled, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("uninstall") { (id: String, profile: String, promise: Promise) in
      ArdiaCoreServices.uninstallExtension(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("reload") { (id: String, profile: String, promise: Promise) in
      ArdiaCoreServices.reloadExtension(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("configure") { (id: String, profile: String, options: [String: Any], promise: Promise) in
      ArdiaCoreServices.configureExtension(id, profile: profile, options: options) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("searchEngineList") { (profile: String, promise: Promise) in
      ArdiaCoreServices.searchEngineList(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("chooseFolder") { (promise: Promise) in
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.allowsMultipleSelection = false
      panel.prompt = "Select"
      panel.message = "Choose an extension folder (with a manifest.json)"
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)
  }
}

enum WebStoreDownload {
  static func crx(id: String, completion: @escaping (String?, String?) -> Void) {
    guard id.range(of: "^[a-p]{32}$", options: .regularExpression) != nil else { return completion(nil, "Not an extension ID.") }
    let chrome = Bundle.main.object(forInfoDictionaryKey: "ACChromiumVersion") as? String ?? "155.0.0.0"
    var url = URLComponents(string: "https://clients2.google.com/service/update2/crx")!
    url.queryItems = [
      URLQueryItem(name: "response", value: "redirect"),
      URLQueryItem(name: "prodversion", value: chrome),
      URLQueryItem(name: "acceptformat", value: "crx2,crx3"),
      URLQueryItem(name: "x", value: "id=\(id)&uc"),
    ]
    URLSession.shared.downloadTask(with: url.url!) { file, response, error in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard let file, error == nil, status == 200 else {
        return DispatchQueue.main.async { completion(nil, error?.localizedDescription ?? "The Chrome Web Store answered \(status).") }
      }
      let dest = FileManager.default.temporaryDirectory.appendingPathComponent("\(id)-\(UUID().uuidString).crx")
      do {
        try FileManager.default.moveItem(at: file, to: dest)
        DispatchQueue.main.async { completion(dest.path, nil) }
      } catch {
        DispatchQueue.main.async { completion(nil, error.localizedDescription) }
      }
    }.resume()
  }
}
