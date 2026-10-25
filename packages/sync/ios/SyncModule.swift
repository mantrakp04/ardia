import AppKit
import ExpoModulesCore
import ArdiaImport
import LocalAuthentication
import Security

public class SyncModule: Module {
  private let state = KeyState()
  private let grants = Grants()
  private static let work = DispatchQueue(label: "ardia.sync", qos: .utility)
  private static let temporaryKits = FileManager.default.temporaryDirectory.appendingPathComponent("Ardia Recovery Kit", isDirectory: true)
  private static let pasteboardLifetime: TimeInterval = 60

  public func definition() -> ModuleDefinition {
    Name("ArdiaSync")

    OnCreate { try? FileManager.default.removeItem(at: Self.temporaryKits) }

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
      self.grants.openRecovery()
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
      let vault = try self.vault(folder)
      return try vault.write(scope: scope, payload: Data(try self.passwords().toWire(payload).utf8))
    }.runOnQueue(Self.work)

    AsyncFunction("read") { (folder: String, scope: String, known: [String]) throws -> [String: Any] in
      let listing = try self.vault(folder).read(scope: scope, skipping: Set(known))
      let passwords = try self.passwords()
      var files: [[String: Any]] = []
      var damaged: [[String: Any]] = listing.damaged.map { ["id": $0.id, "age": $0.age * 1000] }
      for file in listing.files {
        do {
          files.append(["id": file.id, "payload": try passwords.fromWire(String(decoding: file.payload, as: UTF8.self))])
        } catch {
          NSLog("[sync] a synced file's passwords didn't parse; treating it as damaged")
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
      guard let keys = self.state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
      return try keys.seal(Data(text.utf8), scopeTag: "local", fileId: "state").base64EncodedString()
    }.runOnQueue(Self.work)

    AsyncFunction("openLocal") { (sealed: String) -> String? in
      guard let keys = self.state.keys, let data = Data(base64Encoded: sealed),
            let plain = try? keys.open(data, scopeTag: "local", fileId: "state") else { return nil }
      return String(decoding: plain, as: UTF8.self)
    }.runOnQueue(Self.work)

    AsyncFunction("recoveryWords") { (promise: Promise) in
      self.withRecoveryAccess("show your recovery phrase", promise, refused: nil) { promise.resolve(try self.words()) }
    }.runOnQueue(.main)

    AsyncFunction("qrCode") { (promise: Promise) in
      self.withRecoveryAccess("show your recovery phrase", promise, refused: nil) {
        guard let image = RecoveryKit.qrCode(words: try self.words()), let png = RecoveryKit.png(image) else { return promise.resolve(nil) }
        promise.resolve("data:image/png;base64," + png.base64EncodedString())
      }
    }.runOnQueue(.main)

    AsyncFunction("recoveryKitPreview") { (width: Double, promise: Promise) in
      self.withRecoveryAccess("show your Recovery Kit", promise, refused: nil) { promise.resolve(try self.preview(width: CGFloat(width))) }
    }.runOnQueue(.main)

    AsyncFunction("saveRecoveryKit") { (format: String, promise: Promise) in
      self.withRecoveryAccess("save your Recovery Kit", promise, refused: nil) {
        let words = try self.words()
        let panel = NSSavePanel()
        let text = format == "text"
        panel.nameFieldStringValue = text ? RecoveryKit.textName : RecoveryKit.pdfName
        panel.allowedContentTypes = [text ? .plainText : .pdf]
        panel.canCreateDirectories = true
        panel.begin { response in
          guard response == .OK, let url = panel.url else { return promise.resolve(nil) }
          do {
            try Self.kit(words, text: text).write(to: url, options: [.atomic])
            promise.resolve(url.path)
          } catch {
            promise.reject("save", error.localizedDescription)
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("copyRecoveryKit") { (promise: Promise) in
      self.withRecoveryAccess("copy your Recovery Kit", promise, refused: false) {
        let url = try self.temporaryKit()
        let pasteboard = NSPasteboard.general
        pasteboard.prepareForNewContents(with: .currentHostOnly)
        pasteboard.writeObjects([url as NSURL])
        Self.clearPasteboard(after: pasteboard.changeCount) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        promise.resolve(true)
      }
    }.runOnQueue(.main)

    AsyncFunction("shareRecoveryKit") { (promise: Promise) in
      self.withRecoveryAccess("share your Recovery Kit", promise, refused: false) {
        guard let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible), let view = window.contentView else { return promise.resolve(false) }
        let url = try self.temporaryKit()
        let share = KitShare(folder: url.deletingLastPathComponent())
        let picker = NSSharingServicePicker(items: [url])
        picker.delegate = share
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) { share.finish() }
        let point = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        picker.show(relativeTo: NSRect(origin: point, size: .zero), of: view, preferredEdge: .minY)
        promise.resolve(true)
      }
    }.runOnQueue(.main)

    AsyncFunction("copyRecoveryPhrase") { (promise: Promise) in
      self.withRecoveryAccess("copy your recovery phrase", promise, refused: false) {
        let item = NSPasteboardItem()
        item.setString(try self.words().joined(separator: " "), forType: .string)
        item.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        let pasteboard = NSPasteboard.general
        pasteboard.prepareForNewContents(with: .currentHostOnly)
        pasteboard.writeObjects([item])
        Self.clearPasteboard(after: pasteboard.changeCount)
        promise.resolve(true)
      }
    }.runOnQueue(.main)

    AsyncFunction("lockRecoveryPhrase") { self.grants.closeRecovery() }.runOnQueue(.main)

    AsyncFunction("unlockPasswords") { (promise: Promise) in
      self.grants.unlockPasswords { promise.resolve($0) }
    }.runOnQueue(.main)

    Function("passwordsUnlocked") { self.grants.passwordsUnlocked }

    AsyncFunction("openPassword") { (secret: String) -> String? in
      guard self.grants.passwordsUnlocked else { return nil }
      return self.state.passwords?.open(secret)
    }.runOnQueue(Self.work)

    AsyncFunction("protectPasswords") { (passwords: [String]) throws -> [[String: String]] in
      let keys = try self.passwords()
      return try passwords.map { ["d": keys.digest($0), "s": try keys.seal($0)] }
    }.runOnQueue(Self.work)

    AsyncFunction("revealFolder") { (path: String) in
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path, isDirectory: true)])
    }.runOnQueue(.main)

    AsyncFunction("readPasswords") { (engineProfile: String) -> [[String: Any]]? in
      guard self.grants.passwordsUnlocked else {
        if self.grants.firstWaitForPasswords() { NSLog("[sync] passwords wait for unlock") }
        return nil
      }
      guard let passwords = self.state.passwords else { return nil }
      do {
        let key = ChromiumCrypto.deriveKey(secret: try Self.safeStorageSecret())
        let result = try ChromiumSecrets.logins(profile: Self.profileDirectory(engineProfile), key: key)
        if result.undecryptable > 0 {
          NSLog("[sync] \(result.undecryptable) saved passwords didn't decrypt; not syncing passwords now")
          return nil
        }
        return try result.items.map { c in
          ["origin": c.realm ?? c.url, "url": c.url, "username": c.username, "digest": passwords.digest(c.password),
           "secret": try passwords.seal(c.password), "created": c.created ?? 0]
        }
      } catch ImportError.notFound(_) {
        return []
      } catch {
        NSLog("[sync] reading passwords: \(error)")
        return nil
      }
    }.runOnQueue(Self.work)
  }

  private func vault(_ folder: String) throws -> SyncVault {
    guard let keys = state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return SyncVault(folder: URL(fileURLWithPath: folder, isDirectory: true), keys: keys)
  }

  private func passwords() throws -> SyncPasswords {
    guard let passwords = state.passwords else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return passwords
  }

  private func words() throws -> [String] {
    guard let entropy = state.entropy else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return RecoveryPhrase.words(for: entropy)
  }

  private func withRecoveryAccess(_ reason: String, _ promise: Promise, refused: Any?, _ body: @escaping () throws -> Void) {
    grants.recovery(reason: reason) { allowed in
      guard allowed else { return promise.resolve(refused) }
      do {
        try body()
      } catch {
        promise.reject(error)
      }
    }
  }

  private static func clearPasteboard(after changeCount: Int, then cleanup: @escaping () -> Void = {}) {
    DispatchQueue.main.asyncAfter(deadline: .now() + pasteboardLifetime) {
      if NSPasteboard.general.changeCount == changeCount { NSPasteboard.general.clearContents() }
      cleanup()
    }
  }

  private static func kit(_ words: [String], text: Bool) -> Data {
    let device = Host.current().localizedName ?? "this Mac"
    return text ? Data(RecoveryKit.text(words: words, created: Date(), device: device).utf8)
      : RecoveryKit.pdf(words: words, created: Date(), device: device)
  }

  private func temporaryKit() throws -> URL {
    let dir = Self.temporaryKits.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let url = dir.appendingPathComponent(RecoveryKit.pdfName)
    try Self.kit(try words(), text: false).write(to: url, options: [.atomic])
    return url
  }

  private func preview(width: CGFloat) throws -> String? {
    let pdf = Self.kit(try words(), text: false)
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

  private static let environment = ProcessInfo.processInfo.environment
  private static let dataDirectory = environment["ARDIA_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
  private static let testFolder = environment["ARDIA_SYNC_DEFAULT_FOLDER"].map { URL(fileURLWithPath: $0, isDirectory: true) }

  static var defaultFolder: URL {
    if let testFolder { return testFolder }
    if let dataDirectory { return dataDirectory.appendingPathComponent("Ardia Sync", isDirectory: true) }
    let folder = SyncFolder.iCloudDrive.appendingPathComponent("Ardia Sync", isDirectory: true)
    let legacy = SyncFolder.iCloudDrive.appendingPathComponent(LegacyName.syncFolderName, isDirectory: true)
    if !FileManager.default.fileExists(atPath: folder.path), SyncFolder.hasSyncData(legacy) { return legacy }
    return folder
  }

  static let keyStore: SyncKeyStore = dataDirectory.map { FileKeyStore(directory: $0) } ?? KeychainKeyStore()

  static func profileDirectory(_ engineProfile: String) -> URL {
    let root = dataDirectory?.appendingPathComponent("Chromium", isDirectory: true)
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.ardia.browser", isDirectory: true)
      .appendingPathComponent("Chromium", isDirectory: true)
    return root.appendingPathComponent(engineProfile.isEmpty ? "Default" : "Profile \(engineProfile)", isDirectory: true)
  }

  static func safeStorageSecret() throws -> Data {
    if dataDirectory != nil || !isTeamSigned { return Data("mock_password".utf8) }
    return try SafeStorageKeychain.secret(service: "Ardia Safe Storage", account: "Ardia")
  }

  static let isTeamSigned: Bool = {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return false }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return false }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let dict = info as? [String: Any] else { return false }
    return dict[kSecCodeInfoTeamIdentifier as String] != nil
  }()
}

private final class KeyState {
  private let lock = NSLock()
  private var _entropy: Data?
  private var _keys: SyncKeys?
  private var _passwords: SyncPasswords?

  func set(_ entropy: Data?) {
    lock.lock()
    defer { lock.unlock() }
    _entropy = entropy
    _keys = entropy.map(SyncKeys.init(entropy:))
    _passwords = entropy.map(SyncPasswords.init(entropy:))
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

  var passwords: SyncPasswords? {
    lock.lock()
    defer { lock.unlock() }
    return _passwords
  }
}

private final class Grants {
  private enum Purpose {
    case passwords
    case recovery
  }

  private struct Request {
    let token: Int
    let context: LAContext
    var waiting: [(Bool) -> Void]
  }

  private static let recoveryWindow: TimeInterval = 300

  private let lock = NSLock()
  private var passwords = false
  private var recoveryUntil = Date.distantPast
  private var waitLogged = false
  private var asking: [Purpose: Request] = [:]
  private var lastToken = 0

  var passwordsUnlocked: Bool {
    lock.lock()
    defer { lock.unlock() }
    return passwords
  }

  func firstWaitForPasswords() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    defer { waitLogged = true }
    return !waitLogged
  }

  func openRecovery() {
    lock.lock()
    defer { lock.unlock() }
    recoveryUntil = Date().addingTimeInterval(Self.recoveryWindow)
  }

  func closeRecovery() {
    dispatchPrecondition(condition: .onQueue(.main))
    lock.lock()
    recoveryUntil = .distantPast
    lock.unlock()
    guard let request = asking.removeValue(forKey: .recovery) else { return }
    request.context.invalidate()
    for waiting in request.waiting { waiting(false) }
  }

  private var recoveryOpen: Bool {
    lock.lock()
    defer { lock.unlock() }
    return Date() < recoveryUntil
  }

  func unlockPasswords(_ done: @escaping (Bool) -> Void) {
    if passwordsUnlocked { return done(true) }
    ask(.passwords, reason: "sync your saved passwords", done)
  }

  func recovery(reason: String, _ done: @escaping (Bool) -> Void) {
    if recoveryOpen { return done(true) }
    ask(.recovery, reason: reason, done)
  }

  private func ask(_ purpose: Purpose, reason: String, _ done: @escaping (Bool) -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    if asking[purpose] != nil {
      asking[purpose]?.waiting.append(done)
      return
    }
    lastToken += 1
    let token = lastToken
    let context = LAContext()
    asking[purpose] = Request(token: token, context: context, waiting: [done])
    DeviceOwner.confirm(reason, with: context) { granted in
      guard let request = self.asking[purpose], request.token == token else { return }
      self.asking[purpose] = nil
      if granted {
        switch purpose {
        case .passwords:
          self.lock.lock()
          self.passwords = true
          self.lock.unlock()
        case .recovery:
          self.openRecovery()
        }
      }
      for waiting in request.waiting { waiting(granted) }
    }
  }
}

private enum DeviceOwner {
  static func confirm(_ reason: String, with context: LAContext, _ done: @escaping (Bool) -> Void) {
    let environment = ProcessInfo.processInfo.environment
    if environment["ARDIA_BACKGROUND"] == "1" {
      let granted = environment["ARDIA_TEST_REAUTH"] == "granted" && !(environment["ARDIA_DATA_DIR"] ?? "").isEmpty && !signedForDistribution
      NSLog("[sync] device reauth (\(reason)) in a hidden test instance, no prompt: \(granted ? "granted" : "denied")")
      return done(granted)
    }
    var problem: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &problem) else {
      let noPassword = problem?.code == LAError.Code.passcodeNotSet.rawValue
      NSLog("[sync] device reauth (\(reason)) unavailable, \(noPassword ? "this Mac has no password: allowed" : "refused"): \(problem?.localizedDescription ?? "")")
      return done(noPassword)
    }
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { granted, _ in
      DispatchQueue.main.async { done(granted) }
    }
  }

  static let signedForDistribution: Bool = {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return true }
    var requirement: SecRequirement?
    let distribution = "anchor apple generic and (certificate leaf[field.1.2.840.113635.100.6.1.9] exists or "
      + "certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists)"
    guard SecRequirementCreateWithString(distribution as CFString, [], &requirement) == errSecSuccess, let requirement else { return true }
    return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
  }()
}

private final class KitShare: NSObject, NSSharingServicePickerDelegate, NSSharingServiceDelegate {
  private let folder: URL

  init(folder: URL) {
    self.folder = folder
  }

  func finish() {
    try? FileManager.default.removeItem(at: folder)
  }

  func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, delegateFor sharingService: NSSharingService) -> NSSharingServiceDelegate? {
    self
  }

  func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, didChoose service: NSSharingService?) {
    if service == nil { finish() }
  }

  func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
    finish()
  }

  func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) {
    finish()
  }
}
