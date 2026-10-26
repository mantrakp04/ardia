import AppKit
import Foundation
import Security

public enum LegacyName {
  public static let bundleId = "com.netnyahoo.browser"
  public static let appFileName = "Netnyahoo.app"
  public static let appName = "Netnyahoo"

  public static let syncMagic = "NNS1"
  public static let syncSalt = "netnyahoo-sync/v1"
  public static let syncFolderName = "Netnyahoo Sync"
}

enum Renamed {
  struct KeychainItem {
    let oldService: String
    let newService: String
    let account: (old: String, new: String)?
    let label: (String) -> String
    let accessible: CFString?
    let critical: Bool
  }

  static let safeStorage = KeychainItem(
    oldService: "Netnyahoo Safe Storage", newService: "Ardia Safe Storage", account: ("Netnyahoo", "Ardia"),
    label: { _ in "Ardia Safe Storage" }, accessible: nil, critical: true)
  static let connectedAccounts = KeychainItem(
    oldService: "Netnyahoo Connected Accounts", newService: "Ardia Connected Accounts", account: nil,
    label: { "Ardia: \($0)" }, accessible: nil, critical: false)
  static let syncKey = KeychainItem(
    oldService: "Netnyahoo Sync Key", newService: "Ardia Sync Key", account: nil,
    label: { _ in "Ardia Sync Key" }, accessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, critical: false)
  static let keychain = [safeStorage, connectedAccounts, syncKey]

  static let paths: [(old: String, new: String)] = [
    ("Chromium/NetnyahooPictureInPicture.plist", "Chromium/ArdiaPictureInPicture.plist"),
    ("Chromium/NativeMessagingHosts/.netnyahoo-managed.json", "Chromium/NativeMessagingHosts/.ardia-managed.json"),
    ("Chromium/*/Netnyahoo Favicons", "Chromium/*/Ardia Favicons"),
  ]

  static let jsonKeys = [
    "openLinksInSmallYahu": "openLinksInLittleArdia",
    "smallYahuSize": "littleArdiaSize",
    "newSmallYahu": "newLittleArdia",
    "toggleOpenLinksInSmallYahu": "toggleOpenLinksInLittleArdia",
    "nn_sync_key": "ac_sync_key",
  ]

  static let urls: [(old: String, new: String)] = [
    ("netnyahoo://yahu", "ardia://game"),
    ("chrome://yahu", "chrome://game"),
    ("netnyahoo://", "ardia://"),
  ]

  static let defaultsKeys = [
    "NNAppIcon": "ACAppIcon",
    "NNPictureInPictureKeepOnTop": "ACPictureInPictureKeepOnTop",
    "NNPictureInPictureZoom": "ACPictureInPictureZoom",
    "NNUpdateFeedURL": "ACUpdateFeedURL",
  ]
  static let defaultsKeyPrefixes = [("NSWindow Frame Netnyahoo", "NSWindow Frame Ardia")]
  static let menuTitleWords = [("Small Yahu", "Little Ardia"), ("Netnyahoo", "Ardia")]
}

public enum LegacyMigration {
  public struct ScratchInstance {
    public let dataDirectory: String
    public let legacySource: String?
    public let crashAfter: String?

    public init(dataDirectory: String, legacySource: String?, crashAfter: String?) {
      self.dataDirectory = dataDirectory
      self.legacySource = legacySource
      self.crashAfter = crashAfter
    }
  }

  public static func runAtLaunch(scratch: ScratchInstance?, bundleId: String? = Bundle.main.bundleIdentifier) -> Bool {
    let bundleId = bundleId ?? "com.ardia.browser"
    guard bundleId != LegacyName.bundleId else { return true }
    let context: LegacyMigrator.Context?
    if let scratch {
      guard let source = scratch.legacySource, !source.isEmpty else { return true }
      context = testInstanceContext(dataDir: scratch.dataDirectory, legacyHome: source, bundleId: bundleId, crashAfter: scratch.crashAfter)
    } else {
      context = installedContext(bundleId: bundleId)
    }
    guard let context else { return true }
    return LegacyMigrator(context).run() == .proceed
  }

  static func installedContext(bundleId: String) -> LegacyMigrator.Context? {
    #if DEBUG
    return nil
    #else
    let fm = FileManager.default
    guard let library = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
    let support = library.appendingPathComponent("Application Support", isDirectory: true)
    let newData = support.appendingPathComponent(bundleId, isDirectory: true)
    if LegacyMigrator.Context.isDone(newData) { return nil }
    guard let team = teamIdentifier() else { return nil }
    let caches = library.appendingPathComponent("Caches", isDirectory: true)
    let storages = library.appendingPathComponent("HTTPStorages", isDirectory: true)
    var extras: [(URL, URL)] = [(storages.appendingPathComponent(LegacyName.bundleId), storages.appendingPathComponent(bundleId)),
                                (storages.appendingPathComponent("\(LegacyName.bundleId).binarycookies"),
                                 storages.appendingPathComponent("\(bundleId).binarycookies"))]
    let oldCaches = caches.appendingPathComponent(LegacyName.bundleId)
    for name in ((try? fm.contentsOfDirectory(atPath: oldCaches.path)) ?? []) where name != "org.sparkle-project.Sparkle" {
      extras.append((oldCaches.appendingPathComponent(name), caches.appendingPathComponent(bundleId).appendingPathComponent(name)))
    }
    return LegacyMigrator.Context(
      oldData: support.appendingPathComponent(LegacyName.bundleId, isDirectory: true),
      newData: newData,
      extras: extras,
      oldDefaults: PreferencesDomain(id: LegacyName.bundleId),
      newDefaults: PreferencesDomain(id: bundleId),
      oldSecrets: LoginKeychain(),
      newSecrets: LoginKeychain(),
      accessGroups: KeychainAccessGroups.suffixes.map { ("\(team).\(LegacyName.bundleId).\($0)", "\(team).\(bundleId).\($0)") },
      groupMover: KeychainAccessGroups(),
      oldAppRunning: {
        NSRunningApplication.runningApplications(withBundleIdentifier: LegacyName.bundleId).contains {
          !$0.isTerminated && $0.processIdentifier != getpid()
        } || singletonOwnerAlive(support.appendingPathComponent("\(LegacyName.bundleId)/Chromium/SingletonLock"), executable: LegacyName.appName)
      },
      oldAppWasDefaultBrowser: {
        let stored = CFPreferencesCopyValue("LSHandlers" as CFString, launchServicesDomain as CFString, kCFPreferencesCurrentUser,
                                            kCFPreferencesAnyHost) as? [[String: Any]]
        return ["http", "https"].contains {
          isOldApp(defaultFor: $0, live: LSCopyDefaultHandlerForURLScheme($0 as CFString)?.takeRetainedValue() as String?, stored: stored)
        }
      },
      ask: alert)
    #endif
  }

  static func testInstanceContext(dataDir: String, legacyHome: String, bundleId: String, crashAfter: String?) -> LegacyMigrator.Context? {
    let cwd = FileManager.default.currentDirectoryPath
    let absolute = { (path: String) in
      URL(fileURLWithPath: (((path as NSString).isAbsolutePath ? path : (cwd as NSString).appendingPathComponent(path)) as NSString)
        .standardizingPath)
    }
    let data = absolute(dataDir), home = absolute(legacyHome)
    let resolved = { (url: URL) in url.resolvingSymlinksInPath().path }
    let realHome = resolved(URL(fileURLWithPath: NSHomeDirectory()))
    let inside = { (a: String, b: String) in a == b || a.hasPrefix(b + "/") }
    guard resolved(home) != realHome, !inside(resolved(home), realHome + "/Library"), !inside(resolved(data), resolved(home)),
      !inside(resolved(home), resolved(data)) else {
      NSLog("Ardia: the legacy source must be a scratch folder apart from the data dir and your home; ignored")
      return nil
    }
    let library = home.appendingPathComponent("Library")
    let oldData = library.appendingPathComponent("Application Support/\(LegacyName.bundleId)", isDirectory: true)
    let handlers = library.appendingPathComponent("Preferences/\(launchServicesDomain).plist")
    for input in [library, oldData, library.appendingPathComponent("Preferences"), handlers, home.appendingPathComponent("keychain.json")]
    where FileManager.default.fileExists(atPath: input.path) && !inside(resolved(input), resolved(home)) {
      NSLog("Ardia: \(input.path) leads out of the legacy source; ignored")
      return nil
    }
    return LegacyMigrator.Context(
      oldData: oldData,
      newData: data,
      oldDefaults: PreferencesDomain(id: library.appendingPathComponent("Preferences/\(LegacyName.bundleId)").path),
      newDefaults: PreferencesDomain(id: data.appendingPathComponent("Preferences/\(bundleId)").path),
      oldSecrets: SecretFile(url: home.appendingPathComponent("keychain.json")),
      newSecrets: IsolatedSecretStores(dataDirectory: data),
      oldAppRunning: { singletonOwnerAlive(oldData.appendingPathComponent("Chromium/SingletonLock")) },
      oldAppWasDefaultBrowser: {
        let plist = (try? Data(contentsOf: handlers)).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) }
        let stored = (plist as? [String: Any])?["LSHandlers"] as? [[String: Any]]
        return ["http", "https"].contains { isOldApp(defaultFor: $0, live: nil, stored: stored) }
      },
      ask: { _, _, _ in nil },
      crashAfter: crashAfter)
  }

  static let launchServicesDomain = "com.apple.LaunchServices/com.apple.launchservices.secure"

  static func isOldApp(defaultFor scheme: String, live: String?, stored handlers: [[String: Any]]?) -> Bool {
    if let live { return live.lowercased() == LegacyName.bundleId }
    return (handlers ?? []).contains { handler in
      guard (handler["LSHandlerURLScheme"] as? String)?.lowercased() == scheme else { return false }
      return ["LSHandlerRoleAll", "LSHandlerRoleViewer"].contains { (handler[$0] as? String)?.lowercased() == LegacyName.bundleId }
    }
  }

  static func singletonOwnerAlive(_ lock: URL, executable: String? = nil) -> Bool {
    guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: lock.path),
      let pid = target.split(separator: "-").last.flatMap({ pid_t($0) }), pid > 0, pid != getpid() else { return false }
    guard kill(pid, 0) == 0 || errno == EPERM else { return false }
    guard let executable else { return true }
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return false }
    return String(cString: buffer).hasSuffix("/Contents/MacOS/\(executable)")
  }

  static func alert(_ title: String, _ message: String, _ buttons: [String]) -> Int? {
    var response: CFOptionFlags = 0
    let icon = Bundle.main.url(forResource: "AppIcon", withExtension: "icns") as CFURL?
    let result = CFUserNotificationDisplayAlert(
      0, kCFUserNotificationNoteAlertLevel, icon, nil, nil, title as CFString, message as CFString,
      buttons.first as CFString?, buttons.count > 1 ? buttons[1] as CFString : nil, buttons.count > 2 ? buttons[2] as CFString : nil,
      &response)
    guard result == 0 else { return nil }
    switch response & 0x3 {
    case CFOptionFlags(kCFUserNotificationDefaultResponse): return 0
    case CFOptionFlags(kCFUserNotificationAlternateResponse): return 1
    case CFOptionFlags(kCFUserNotificationOtherResponse): return 2
    default: return nil
    }
  }

  static func teamIdentifier() -> String? {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return nil }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
      let dict = info as? [String: Any] else { return nil }
    return dict[kSecCodeInfoTeamIdentifier as String] as? String
  }
}

extension LegacyMigration {
  public static func moveToNewName(launched: String? = launchedExecutable(), running: @escaping () -> String? = runningExecutable) {
    guard let launched else { return }
    let executable = URL(fileURLWithPath: launched)
    let macOS = executable.deletingLastPathComponent(), contents = macOS.deletingLastPathComponent()
    let old = contents.deletingLastPathComponent(), name = executable.lastPathComponent
    guard macOS.lastPathComponent == "MacOS", contents.lastPathComponent == "Contents", old.lastPathComponent == LegacyName.appFileName,
      !old.path.contains("/AppTranslocation/"), "\(name).app" != old.lastPathComponent,
      let folder = realpath(old.deletingLastPathComponent().path, nil) else { return }
    let resolvedFolder = String(cString: folder)
    free(folder)
    let new = old.deletingLastPathComponent().appendingPathComponent("\(name).app")
    let log = { (message: String) in NSLog("Ardia: renaming \(old.path): \(message)") }
    var info = stat()
    let isIn = { (bundle: URL) in (running() ?? "").hasPrefix("\(resolvedFolder)/\(bundle.lastPathComponent)/") }
    let isBundle = lstat(old.path, &info) == 0 && info.st_mode & S_IFMT == S_IFDIR && isIn(old)
    let moved = isBundle && renamex_np(old.path, new.path, UInt32(RENAME_EXCL)) == 0
    let error = String(cString: strerror(errno))
    guard isIn(new) else {
      if moved {
        log("renamed it, but this app isn't in it (it was replaced a moment ago); runs as it is")
      } else if isBundle {
        log("stays: \(error)")
      }
      return
    }
    if moved { LSRegisterURL(new as CFURL, true) }
    let path = new.appendingPathComponent("Contents/MacOS").appendingPathComponent(name).path
    var argv = (0..<Int(CommandLine.argc)).map { CommandLine.unsafeArgv[$0] }
    if argv.isEmpty { argv.append(nil) }
    argv[0] = strdup(path)
    argv.append(nil)
    execv(path, argv)
    log("couldn't start from \(new.lastPathComponent): \(String(cString: strerror(errno))); quitting")
    exit(EXIT_FAILURE)
  }

  public static func launchedExecutable() -> String? {
    var size: UInt32 = 0
    _NSGetExecutablePath(nil, &size)
    var buffer = [CChar](repeating: 0, count: Int(size) + 1)
    guard _NSGetExecutablePath(&buffer, &size) == 0 else { return nil }
    return String(cString: buffer)
  }

  public static func runningExecutable() -> String? {
    var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    guard proc_pidpath(getpid(), &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return String(cString: buffer)
  }
}

extension LegacyMigration {
  public static func namesJSON() -> Data {
    let names: [String: Any] = [
      "bundleId": LegacyName.bundleId,
      "appFileName": LegacyName.appFileName,
      "appName": LegacyName.appName,
      "keychain": Renamed.keychain.map { item -> [String: Any] in
        var entry: [String: Any] = ["oldService": item.oldService, "newService": item.newService]
        if let account = item.account { entry["oldAccount"] = account.old; entry["newAccount"] = account.new }
        return entry
      },
      "paths": Renamed.paths.map { [$0.old, $0.new] },
      "jsonKeys": Renamed.jsonKeys,
      "urls": Renamed.urls.map { [$0.old, $0.new] },
      "defaultsKeys": Renamed.defaultsKeys,
      "defaultsKeyPrefixes": Renamed.defaultsKeyPrefixes.map { [$0.0, $0.1] },
      "menuTitleWords": Renamed.menuTitleWords.map { [$0.0, $0.1] },
    ]
    return (try? JSONSerialization.data(withJSONObject: names, options: [.sortedKeys, .prettyPrinted])) ?? Data()
  }
}
