import AppKit
import ArdiaCore
import ExpoModulesCore
import ServiceManagement
import UniformTypeIdentifiers

public class SystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSystem")

    Constant("backgroundInstance") { () -> Bool in LaunchConfig.shared.background }

    AsyncFunction("isDefaultBrowser") { () -> Bool in
      guard let probe = URL(string: "https://example.com"),
            let handler = NSWorkspace.shared.urlForApplication(toOpen: probe) else { return false }
      return handler.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL
    }.runOnQueue(.main)

    AsyncFunction("setAsDefaultBrowser") { (promise: Promise) in
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not setting the default browser")
        return promise.resolve(false)
      }
      let app = Bundle.main.bundleURL
      NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "http") { error in
        guard error == nil else { return promise.resolve(false) }
        NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "https") { _ in
          DispatchQueue.main.async {
            let handler = URL(string: "https://example.com").flatMap(NSWorkspace.shared.urlForApplication(toOpen:))
            promise.resolve(handler?.standardizedFileURL == app.standardizedFileURL)
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("launchAtLoginStatus") { () -> String in
      switch SMAppService.mainApp.status {
      case .enabled: return "enabled"
      case .requiresApproval: return "requiresApproval"
      case .notFound: return "notFound"
      default: return "notRegistered"
      }
    }.runOnQueue(.main)

    AsyncFunction("setLaunchAtLogin") { (enabled: Bool) in
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not changing launch at login")
        return
      }
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    }.runOnQueue(.main)

    Function("fileExists") { (path: String) -> Bool in FileManager.default.fileExists(atPath: path) }

    AsyncFunction("openFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not opening %@", path)
        return true
      }
      return NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }.runOnQueue(.main)

    AsyncFunction("revealFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not revealing %@", path)
        return true
      }
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
      return true
    }.runOnQueue(.main)

    AsyncFunction("moveToTrash") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      do {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        return true
      } catch {
        return false
      }
    }.runOnQueue(.main)

    AsyncFunction("fileIcon") { (path: String, size: Double) -> String? in
      let icon = FileManager.default.fileExists(atPath: path)
        ? NSWorkspace.shared.icon(forFile: path)
        : NSWorkspace.shared.icon(for: .init(filenameExtension: (path as NSString).pathExtension) ?? .data)
      return icon.pngDataURL(points: CGFloat(size), scale: 2)
    }.runOnQueue(.main)

    AsyncFunction("runningAppIcon") { (pid: Int, size: Double) -> String? in
      NSRunningApplication(processIdentifier: pid_t(pid))?.icon?.pngDataURL(points: CGFloat(size), scale: 2)
    }.runOnQueue(.main)

    Function("hapticTick") {
      DispatchQueue.main.async {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        HapticLog.note("alignment")
      }
    }

    AsyncFunction("setThinScrollBars") { (thin: Bool) in ThinScrollBars.set(thin) }.runOnQueue(.main)
  }
}
