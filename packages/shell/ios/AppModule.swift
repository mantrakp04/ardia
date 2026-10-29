import AppKit
import ArdiaCore
import MachO
import ExpoModulesCore

public class AppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaApp")
    Constant("apiVersion") { () -> Int in 35 }

    OnCreate {
      DispatchQueue.main.async { AppIcons.restore() }
    }

    AsyncFunction("setWindowActivity") { (windowId: String, url: String?, title: String?) in
      Handoff.setActivity(windowId: windowId, url: url, title: title)
    }.runOnQueue(.main)

    AsyncFunction("share") { (url: String, title: String?, windowId: String?, anchor: [Double]?, promise: Promise) in
      SharePicker.show(url: url, title: title, windowId: windowId, anchor: anchor) { promise.resolve(nil) }
    }.runOnQueue(.main)

    AsyncFunction("shareVia") { (service: String, url: String, title: String?, windowId: String?) in
      SharePicker.perform(service: service, url: url, title: title, windowId: windowId)
    }.runOnQueue(.main)

    AsyncFunction("isInDock") { () -> Bool in DockTile.isInDock }.runOnQueue(.main)
    AsyncFunction("addToDock") { () -> Bool in DockTile.add() }.runOnQueue(.main)

    AsyncFunction("appIcons") { (size: Double) -> [[String: Any]] in
      AppIcons.variants.map { ["id": $0.id, "name": $0.name, "preview": AppIcons.preview($0.id, size: size) as Any] }
    }.runOnQueue(.main)
    AsyncFunction("appIcon") { () -> String in AppIcons.current }.runOnQueue(.main)
    AsyncFunction("setAppIcon") { (id: String) in AppIcons.set(id, announce: !LaunchConfig.shared.isolated) }.runOnQueue(.main)

    Function("systemInfo") { () -> [String: Any] in
      let info = Bundle.main.infoDictionary ?? [:]
      let config = LaunchConfig.shared
      let os = ProcessInfo.processInfo.operatingSystemVersion
      var model = [CChar](repeating: 0, count: 256)
      var size = model.count
      sysctlbyname("hw.model", &model, &size, nil, 0)
      #if DEBUG
      let configuration = "Debug"
      #else
      let configuration = "Release"
      #endif
      return [
        "appName": info["CFBundleName"] as? String ?? "Ardia",
        "appVersion": info["CFBundleShortVersionString"] as? String ?? "",
        "appBuild": info["CFBundleVersion"] as? String ?? "",
        "bundleId": Bundle.main.bundleIdentifier ?? "",
        "configuration": configuration,
        "osVersion": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
        "osBuild": Self.osBuild,
        "arch": Self.arch,
        "model": String(cString: model),
        "memoryGB": Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824,
        "locale": Locale.current.identifier,
        "feedbackURL": Self.infoString("ACFeedbackURL") as Any,
        "feedbackEmail": Self.infoString("ACFeedbackEmail") as Any,
        "videoTourURL": Self.infoString("ACVideoTourURL") as Any,
        "releaseNotesURL": Self.infoString("ACReleaseNotesURL") as Any,
        "isolatedInstance": config.isolated,
        "forceReleaseNotes": config.instanceFlag("releaseNotes"),
        "processStart": Self.processStart as Any,
        "bootTime": Self.bootTime as Any,
        "inApplicationsFolder": Self.inApplicationsFolder,
        "updatePrewarm": UserDefaults.standard.dictionary(forKey: UpdatePrewarm.lastRunKey) as Any,
      ]
    }

    AsyncFunction("crashReports") { (since: Double) -> [[String: Any]] in CrashReports.since(since) }

    AsyncFunction("openExternalURL") { (url: String) -> Bool in
      guard let target = URL(string: url), target.scheme != nil else { return false }
      return NSWorkspace.shared.open(target)
    }.runOnQueue(.main)

    AsyncFunction("playIntroMusic") { (cues: [String: Double], muted: Bool) in IntroMusic.shared.play(cues: cues, muted: muted) }.runOnQueue(.main)
    AsyncFunction("setIntroMusicMuted") { (muted: Bool) in IntroMusic.shared.setMuted(muted) }.runOnQueue(.main)
    AsyncFunction("stopIntroMusic") { (fade: Double) in IntroMusic.shared.stop(fade: fade) }.runOnQueue(.main)
    Function("launchConfig") { () -> [String: Any] in LaunchConfig.shared.snapshot }
  }

  private static func infoString(_ key: String) -> String? {
    let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return value?.isEmpty == false ? value : nil
  }

  private static var osBuild: String {
    var size = 0
    sysctlbyname("kern.osversion", nil, &size, nil, 0)
    var build = [CChar](repeating: 0, count: max(size, 1))
    sysctlbyname("kern.osversion", &build, &size, nil, 0)
    return String(cString: build)
  }

  private static var arch: String {
    #if arch(arm64)
    "arm64"
    #else
    "x86_64"
    #endif
  }

  private static var inApplicationsFolder: Bool {
    let path = Bundle.main.bundleURL.resolvingSymlinksInPath().path
    let home = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path
    return path.hasPrefix("/Applications/") || path.hasPrefix(home + "/Applications/")
  }
}

extension AppModule {
  fileprivate static let bootTime: Double? = {
    var boot = timeval()
    var size = MemoryLayout<timeval>.stride
    var mib: [Int32] = [CTL_KERN, KERN_BOOTTIME]
    guard sysctl(&mib, 2, &boot, &size, nil, 0) == 0 else { return nil }
    return Double(boot.tv_sec) * 1000 + Double(boot.tv_usec) / 1000
  }()

  fileprivate static let processStart: Double? = {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
    let start = info.kp_proc.p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }()
}
