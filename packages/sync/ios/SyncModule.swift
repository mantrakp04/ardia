import AppKit
import ArdiaCore
import ExpoModulesCore
import LocalAuthentication

public class SyncModule: Module {
  private let state = KeyState()
  private let owner = DeviceOwnerCheck()
  private static let work = DispatchQueue(label: "ardia.sync", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("ArdiaSync")

    OnCreate { Self.work.async { Self.removeTemporaryKits() } }

    AsyncFunction("folderInfo") { (path: String?) -> [String: Any] in
      let url = path.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? Self.defaultFolder
      var isDirectory: ObjCBool = false
      let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
      return [
        "path": url.path,
        "defaultPath": Self.defaultFolder.path,
        "iCloudAvailable": Self.testFolder != nil || SyncFolder.iCloudDriveAvailable,
        "inICloud": SyncFolder.isInICloudDrive(url),
        "exists": exists,
        "writable": exists && FileManager.default.isWritableFile(atPath: url.path),
        "hasSyncData": exists && SyncFolder.hasSyncData(url),
      ]
    }.runOnQueue(Self.work)

    AsyncFunction("chooseFolder") { (current: String?, promise: Promise) in
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.canCreateDirectories = true
      panel.allowsMultipleSelection = false
      panel.prompt = "Use Folder"
      panel.message = "Choose a folder that syncs between your Macs, like one in iCloud Drive or Dropbox, or on a NAS or USB drive."
      if let current { panel.directoryURL = URL(fileURLWithPath: current, isDirectory: true) }
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)

    Function("newDeviceId") { SyncKeys.newFileId() }

    Function("deviceName") { Host.current().localizedName ?? "This Mac" }

    AsyncFunction("createPhrase") { (account: String) -> Bool in
      let entropy = RecoveryPhrase.generateEntropy()
      guard Self.keyStore.save(entropy, account: account) else { return false }
      self.state.set(entropy)
      return true
    }.runOnQueue(Self.work)

    AsyncFunction("enterPhrase") { (account: String, text: String, folder: String) -> [String: Any] in
      let entropy: Data
      do {
        entropy = try RecoveryPhrase.entropy(from: text)
      } catch let problem as RecoveryPhrase.Problem {
        switch problem {
        case .wordCount(let n): return ["error": "wordCount", "count": n]
        case .unknownWord(let word): return ["error": "unknownWord", "word": word]
        case .checksum: return ["error": "checksum"]
        }
      }
      let folderURL = URL(fileURLWithPath: folder, isDirectory: true)
      if !SyncVault(folder: folderURL, keys: SyncKeys(entropy: entropy)).chainExists() {
        return ["error": SyncFolder.hasSyncData(folderURL) ? "mismatch" : "noData"]
      }
      guard Self.keyStore.save(entropy, account: account) else { return ["error": "keychain"] }
      self.state.set(entropy)
      return ["ok": true]
    }.runOnQueue(Self.work)

    AsyncFunction("unlock") { (account: String) -> Bool in
      guard let entropy = Self.keyStore.load(account: account), entropy.count == 32 else { return false }
      self.state.set(entropy)
      return true
    }.runOnQueue(Self.work)

    AsyncFunction("forget") { (account: String) in
      Self.keyStore.delete(account: account)
      self.state.set(nil)
      self.owner.revoke()
    }.runOnQueue(Self.work)

    AsyncFunction("chainStatus") { (folder: String) throws -> String in
      let vault = try self.vault(folder)
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: folder, isDirectory: &isDirectory), isDirectory.boolValue else { return "unavailable" }
      return vault.chainExists() ? "ok" : "missing"
    }.runOnQueue(Self.work)

    AsyncFunction("createChain") { (folder: String) throws in
      try FileManager.default.createDirectory(at: URL(fileURLWithPath: folder, isDirectory: true), withIntermediateDirectories: true)
      try self.vault(folder).createChain()
    }.runOnQueue(Self.work)

    AsyncFunction("write") { (folder: String, scope: String, payload: String) throws -> String in
      try self.ensureLocalStateReadable()
      let vault = try self.vault(folder)
      return try vault.write(scope: scope, payload: LegacyPasswords.restore(Data(payload.utf8), keys: vault.keys))
    }.runOnQueue(Self.work)

    AsyncFunction("read") { (folder: String, scope: String, known: [String]) throws -> [String: Any] in
      let vault = try self.vault(folder)
      let listing: SyncVault.Listing
      do {
        listing = try vault.read(scope: scope, skipping: Set(known))
      } catch {
        throw Exception(name: "folderUnreadable", description: "The sync folder couldn't be read: \(error.localizedDescription)", code: "ERR_SYNC_FOLDER_UNREADABLE")
      }
      var files: [[String: Any]] = []
      var damaged: [[String: Any]] = listing.damaged.map { ["id": $0.id, "age": $0.age * 1000] }
      for file in listing.files {
        if let payload = LegacyPasswords.hide(file.payload, keys: vault.keys) {
          files.append(["id": file.id, "payload": payload])
        } else {
          damaged.append(["id": file.id, "age": 0])
        }
      }
      return ["files": files, "pending": listing.pending, "damaged": damaged, "present": listing.present]
    }.runOnQueue(Self.work)

    AsyncFunction("remove") { (folder: String, scope: String, ids: [String]) throws in
      try self.vault(folder).remove(scope: scope, ids: ids)
    }.runOnQueue(Self.work)

    AsyncFunction("deleteChain") { (folder: String) throws in
      try self.vault(folder).deleteChain()
    }.runOnQueue(Self.work)

    AsyncFunction("sealLocal") { (text: String) throws -> String in
      try self.ensureLocalStateReadable()
      guard let keys = self.state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
      return try keys.seal(Data(text.utf8), scopeTag: "local", fileId: "state").base64EncodedString()
    }.runOnQueue(Self.work)

    AsyncFunction("openLocal") { (sealed: String) -> String? in
      guard let keys = self.state.keys, let data = Data(base64Encoded: sealed),
            let plain = try? keys.open(data, scopeTag: "local", fileId: "state") else { return nil }
      guard let json = LegacyPasswords.hide(plain, keys: keys) else {
        self.state.markLocalUnreadable()
        return nil
      }
      return json
    }.runOnQueue(Self.work)

    AsyncFunction("recoveryWords") { (promise: Promise) in
      self.disclose(promise, on: Self.work) { try self.words() }
    }.runOnQueue(Self.work)

    AsyncFunction("qrCode") { (promise: Promise) in
      self.disclose(promise, on: Self.work) { () throws -> String? in
        guard let image = RecoveryKit.qrCode(words: try self.words()), let png = RecoveryKit.png(image) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
      }
    }.runOnQueue(Self.work)

    AsyncFunction("recoveryKitPreview") { (width: Double) throws -> String? in
      _ = try self.words()
      return Self.preview(width: CGFloat(width))
    }.runOnQueue(.main)

    AsyncFunction("saveRecoveryKit") { (format: String, promise: Promise) in
      guard (try? self.words()) != nil else { return promise.reject("locked", "Sync isn't set up on this Mac.") }
      let panel = NSSavePanel()
      let text = format == "text"
      panel.nameFieldStringValue = text ? RecoveryKit.textName : RecoveryKit.pdfName
      panel.allowedContentTypes = [text ? .plainText : .pdf]
      panel.canCreateDirectories = true
      panel.begin { response in
        guard response == .OK, let url = panel.url else { return promise.resolve(nil) }
        self.disclose(promise, on: .main) { () throws -> String? in
          try Self.kit(try self.words(), text: text).write(to: url, options: [.atomic])
          return url.path
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("copyRecoveryKit") { (promise: Promise) in
      self.disclose(promise, on: .main) { () throws -> Bool in
        let url = try self.temporaryKit()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([url as NSURL])
        return true
      }
    }.runOnQueue(.main)

    AsyncFunction("shareRecoveryKit") { (promise: Promise) in
      self.disclose(promise, on: .main) { () throws -> Bool in
        guard let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible), let view = window.contentView else { return false }
        let url = try self.temporaryKit()
        let point = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        NSSharingServicePicker(items: [url]).show(relativeTo: NSRect(origin: point, size: .zero), of: view, preferredEdge: .minY)
        return true
      }
    }.runOnQueue(.main)

    AsyncFunction("copyRecoveryPhrase") { (promise: Promise) in
      self.disclose(promise, on: .main) { () throws -> Bool in
        let words = try self.words().joined(separator: " ")
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.declareTypes([.string, NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")], owner: nil)
        pasteboard.setString(words, forType: .string)
        pasteboard.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        return true
      }
    }.runOnQueue(.main)

    AsyncFunction("revealFolder") { (path: String) in
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path, isDirectory: true)])
    }.runOnQueue(.main)

    AsyncFunction("readPasswords") { (engineProfile: String, promise: Promise) in
      DispatchQueue.main.async {
        ArdiaEngineBridge.callForSecretReply("ac_passwords_logins", profile: engineProfile, timeout: Self.loginsTimeout) { reply in
          promise.resolve(self.sealedLogins(reply))
        }
      }
    }

    AsyncFunction("savePassword") { (engineProfile: String, origin: String, username: String, sealed: String, replacing: Bool, promise: Promise) in
      guard let keys = self.state.keys, let password = try? keys.openPassword(sealed, origin: origin, username: username) else {
        NSLog("[sync] a synced password didn't open for its login; not saving it")
        return promise.resolve(false)
      }
      let save = {
        ArdiaServices.savePassword(profile: engineProfile, origin: origin, username: username, password: password) { _, error in
          if let error { NSLog("[sync] saving a synced password: \(error)") }
          promise.resolve(error == nil)
        }
      }
      DispatchQueue.main.async {
        guard replacing else { return save() }
        ArdiaServices.deletePassword(profile: engineProfile, origin: origin, username: username) { _, error in
          guard let error else { return save() }
          NSLog("[sync] replacing a saved password: \(error)")
          promise.resolve(false)
        }
      }
    }.runOnQueue(Self.work)
  }

  private func disclose<T>(_ promise: Promise, on queue: DispatchQueue, _ reveal: @escaping () throws -> T?) {
    guard (try? words()) != nil else { return promise.reject("locked", "Sync isn't set up on this Mac.") }
    owner.confirm(reason: "show your sync recovery phrase") { granted in
      queue.async {
        guard granted else { return promise.resolve(nil) }
        do {
          promise.resolve(try reveal())
        } catch {
          promise.reject(error)
        }
      }
    }
  }

  private func sealedLogins(_ reply: [String: Any]?) -> [[String: Any]]? {
    guard let keys = state.keys else { return nil }
    guard let logins = reply?["logins"] as? [[String: Any]] else {
      NSLog("[sync] reading passwords: \(reply?["error"] ?? "no reply")")
      return nil
    }
    var sealed: [[String: Any]] = []
    var seen = Set<String>()
    for login in logins {
      guard let realm = login["realm"] as? String, let username = login["username"] as? String,
            let password = login["password"] as? String, let created = login["created"] as? Double else {
        NSLog("[sync] reading passwords: a malformed login; not syncing passwords now")
        return nil
      }
      guard seen.insert("\(realm)\u{0}\(username)").inserted, let origin = Self.loginOrigin(realm) else { continue }
      guard let seal = try? keys.sealPassword(password, origin: origin, username: username) else { return nil }
      sealed.append(["origin": origin, "username": username, "sealed": seal, "created": created])
    }
    return sealed
  }

  static func loginOrigin(_ realm: String) -> String? {
    let origin = realm.hasSuffix("/") ? String(realm.dropLast()) : realm
    return origin.range(of: #"^https?://[^/\s]+$"#, options: .regularExpression) != nil ? origin : nil
  }

  private func ensureLocalStateReadable() throws {
    if state.localUnreadable {
      throw Exception(name: "unreadable", description: "This Mac's sync state couldn't be read safely, so sync is paused to keep it.")
    }
  }

  private func vault(_ folder: String) throws -> SyncVault {
    guard let keys = state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return SyncVault(folder: URL(fileURLWithPath: folder, isDirectory: true), keys: keys)
  }

  private func words() throws -> [String] {
    guard let entropy = state.entropy else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return RecoveryPhrase.words(for: entropy)
  }

  private static func kit(_ words: [String], text: Bool) -> Data {
    let device = Host.current().localizedName ?? "this Mac"
    return text ? Data(RecoveryKit.text(words: words, created: Date(), device: device).utf8)
      : RecoveryKit.pdf(words: words, created: Date(), device: device)
  }

  private static let temporaryKitFolder = FileManager.default.temporaryDirectory.appendingPathComponent("Ardia Recovery Kit", isDirectory: true)

  private static func removeTemporaryKits() {
    try? FileManager.default.removeItem(at: temporaryKitFolder)
  }

  private func temporaryKit() throws -> URL {
    let dir = Self.temporaryKitFolder
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let url = dir.appendingPathComponent(RecoveryKit.pdfName)
    try Self.kit(try words(), text: false).write(to: url, options: [.atomic])
    return url
  }

  private static let hiddenWords = Array(repeating: "••••••", count: 24)

  private static func preview(width: CGFloat) -> String? {
    let pdf = kit(hiddenWords, text: false)
    guard let page = NSImage(data: pdf) else { return nil }
    let scale = (NSScreen.main?.backingScaleFactor ?? 2)
    let size = NSSize(width: width, height: width * page.size.height / page.size.width)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    page.draw(in: NSRect(origin: .zero, size: size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
  }

  private static let dataDirectory = LaunchConfig.shared.dataDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
  private static let testFolder = LaunchConfig.shared.instance("syncFolder").map { URL(fileURLWithPath: $0, isDirectory: true) }

  static var defaultFolder: URL {
    if let testFolder { return testFolder }
    if let dataDirectory { return dataDirectory.appendingPathComponent("Ardia Sync", isDirectory: true) }
    let folder = SyncFolder.iCloudDrive.appendingPathComponent("Ardia Sync", isDirectory: true)
    let legacy = SyncFolder.iCloudDrive.appendingPathComponent(LegacyName.syncFolderName, isDirectory: true)
    if !FileManager.default.fileExists(atPath: folder.path), SyncFolder.hasSyncData(legacy) { return legacy }
    return folder
  }

  static let keyStore: SyncKeyStore = dataDirectory.map { FileKeyStore(directory: $0) } ?? KeychainKeyStore()

  static let loginsTimeout = LaunchConfig.shared.testValue("loginsTimeout").flatMap(TimeInterval.init) ?? 30
}

private final class KeyState {
  private let lock = NSLock()
  private var _entropy: Data?
  private var _keys: SyncKeys?
  private var _localUnreadable = false

  func set(_ entropy: Data?) {
    lock.lock()
    defer { lock.unlock() }
    _entropy = entropy
    _keys = entropy.map(SyncKeys.init(entropy:))
    _localUnreadable = false
  }

  func markLocalUnreadable() {
    lock.lock()
    defer { lock.unlock() }
    _localUnreadable = true
  }

  var localUnreadable: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _localUnreadable
  }

  var entropy: Data? {
    lock.lock()
    defer { lock.unlock() }
    return _entropy
  }

  var keys: SyncKeys? {
    lock.lock()
    defer { lock.unlock() }
    return _keys
  }
}

private final class DeviceOwnerCheck {
  private static let validity: UInt64 = 60 * NSEC_PER_SEC
  private let lock = NSLock()
  private var grantedAt: UInt64?
  private var waiting: [(Bool) -> Void]?

  private static var now: UInt64 { clock_gettime_nsec_np(CLOCK_MONOTONIC) }

  func revoke() {
    lock.lock()
    grantedAt = nil
    lock.unlock()
  }

  func confirm(reason: String, then done: @escaping (Bool) -> Void) {
    lock.lock()
    if let grantedAt, Self.now - grantedAt < Self.validity {
      lock.unlock()
      return done(true)
    }
    if waiting != nil {
      waiting?.append(done)
      lock.unlock()
      return
    }
    waiting = [done]
    lock.unlock()
    Self.evaluate(reason) { granted in
      self.lock.lock()
      if granted { self.grantedAt = Self.now }
      let everyone = self.waiting ?? []
      self.waiting = nil
      self.lock.unlock()
      everyone.forEach { $0(granted) }
    }
  }

  private static func evaluate(_ reason: String, _ done: @escaping (Bool) -> Void) {
    let config = LaunchConfig.shared
    if config.background {
      let granted = config.testValue("reauth") == "granted"
      NSLog("[sync] device owner check (%@) in a hidden test instance, no prompt: %@", reason, granted ? "granted" : "denied")
      return done(granted)
    }
    let context = LAContext()
    var problem: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &problem) else {
      NSLog("[sync] device owner check unavailable: %@", problem?.localizedDescription ?? "unknown")
      return done(false)
    }
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { granted, _ in
      withExtendedLifetime(context) { done(granted) }
    }
  }
}

private enum LegacyPasswords {
  private static let prefix = "pw:"
  private static let marker = Data("\"pw:".utf8)

  static func hide(_ json: Data, keys: SyncKeys) -> String? {
    guard json.range(of: marker) != nil else { return String(decoding: json, as: UTF8.self) }
    do {
      return String(decoding: try rewrite(json, keys: keys, hiding: true), as: UTF8.self)
    } catch {
      let problem = error as NSError
      NSLog("[sync] a sync document with legacy passwords couldn't be sealed (%@ %ld); not reading it", problem.domain, problem.code)
      return nil
    }
  }

  static func restore(_ json: Data, keys: SyncKeys) throws -> Data {
    guard json.range(of: marker) != nil else { return json }
    return try rewrite(json, keys: keys, hiding: false)
  }

  private static func rewrite(_ json: Data, keys: SyncKeys, hiding: Bool) throws -> Data {
    let tree: Any
    do {
      tree = try JSONSerialization.jsonObject(with: json, options: [.fragmentsAllowed])
    } catch {
      tree = try JSONSerialization.jsonObject(with: withoutLoneSurrogates(json), options: [.fragmentsAllowed])
    }
    return try JSONSerialization.data(withJSONObject: try walk(tree, keys: keys, hiding: hiding), options: [.fragmentsAllowed, .withoutEscapingSlashes])
  }

  private static func withoutLoneSurrogates(_ json: Data) -> Data {
    let bytes = [UInt8](json)
    var out = [UInt8]()
    out.reserveCapacity(bytes.count)
    func unit(_ i: Int) -> Int? {
      guard i + 5 < bytes.count, bytes[i] == 0x5C, bytes[i + 1] == 0x75 else { return nil }
      return Int(String(decoding: bytes[(i + 2)...(i + 5)], as: UTF8.self), radix: 16)
    }
    var i = 0
    while i < bytes.count {
      guard bytes[i] == 0x5C, i + 1 < bytes.count else {
        out.append(bytes[i])
        i += 1
        continue
      }
      if let value = unit(i), (0xD800...0xDFFF).contains(value) {
        if value <= 0xDBFF, let next = unit(i + 6), (0xDC00...0xDFFF).contains(next) {
          out.append(contentsOf: bytes[i..<(i + 12)])
          i += 12
        } else {
          out.append(contentsOf: Array(#"\ufffd"#.utf8))
          i += 6
        }
      } else {
        out.append(contentsOf: bytes[i...(i + 1)])
        i += 2
      }
    }
    return Data(out)
  }

  private static func walk(_ node: Any, keys: SyncKeys, hiding: Bool) throws -> Any {
    if let list = node as? [Any] { return try list.map { try walk($0, keys: keys, hiding: hiding) } }
    guard var object = node as? [String: Any] else { return node }
    if let key = object["k"] as? String, key.hasPrefix(prefix), let value = object["v"] {
      object["v"] = try password(value, keys: keys, hiding: hiding)
      return object
    }
    for (key, value) in object {
      if !key.hasPrefix(prefix) {
        object[key] = try walk(value, keys: keys, hiding: hiding)
      } else if value is String {
        object[key] = nil
      } else if var record = value as? [String: Any], let inner = record["v"] {
        record["v"] = try password(inner, keys: keys, hiding: hiding)
        object[key] = record
      }
    }
    return object
  }

  private static func password(_ value: Any, keys: SyncKeys, hiding: Bool) throws -> Any {
    guard var login = value as? [String: Any], let origin = login["o"] as? String, let username = login["u"] as? String else { return value }
    if hiding, let plain = login["p"] as? String {
      login["p"] = nil
      login["s"] = try keys.sealPassword(plain, origin: origin, username: username)
    } else if !hiding, let sealed = login["s"] as? String {
      login["s"] = nil
      login["p"] = try keys.openPassword(sealed, origin: origin, username: username)
    }
    return login
  }
}
