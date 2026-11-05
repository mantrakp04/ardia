import ExpoModulesCore
import Foundation

final class UserScripts {
  static let shared = UserScripts()
  static let work = DispatchQueue(label: "ardia.userscripts", qos: .utility)

  private static let manifestLimit = 1 << 20
  private static let lockAttempts = 200
  private static let lockRetryMicroseconds: useconds_t = 50_000
  private static let topKeys: Set<String> = ["manifest_version", "name", "version", "description", "content_scripts"]
  private static let entryKeys: Set<String> = [
    "matches", "exclude_matches", "include_globs", "exclude_globs", "js", "css", "run_at", "all_frames", "world",
    "match_about_blank", "match_origin_as_fallback",
  ]
  private static let stringListKeys = ["matches", "exclude_matches", "include_globs", "exclude_globs", "js", "css"]
  private static let flagKeys = ["all_frames", "match_about_blank", "match_origin_as_fallback"]
  private static let runAts: Set<String> = ["document_start", "document_end", "document_idle"]
  private static let worlds: Set<String> = ["ISOLATED", "MAIN"]

  var emit: (() -> Void)?
  private var source: DispatchSourceFileSystemObject?
  private var lastSignature: String?

  private struct Refused: Error {
    let message: String
    init(_ message: String) { self.message = message }
  }

  private var dir: URL? { try? DocumentStore.url("Scripts") }

  func start() {
    UserScripts.work.async { self.arm() }
  }

  func stop() {
    UserScripts.work.async {
      self.source?.cancel()
      self.source = nil
      self.lastSignature = nil
    }
  }

  private func arm() {
    guard source == nil, let dir else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let fd = open(dir.path, O_EVTONLY | O_CLOEXEC)
    guard fd >= 0 else { return }
    let watch = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .delete, .rename], queue: UserScripts.work)
    watch.setEventHandler { [weak self, weak watch] in
      guard let self, let watch, self.source === watch else { return }
      if !watch.data.isDisjoint(with: [.delete, .rename]) {
        watch.cancel()
        self.source = nil
        self.arm()
      }
      self.noticeChange()
    }
    watch.setCancelHandler { close(fd) }
    source = watch
    lastSignature = signature(dir)
    watch.resume()
  }

  private func noticeChange() {
    guard let dir else { return }
    let now = signature(dir)
    guard now != lastSignature else { return }
    lastSignature = now
    emit?()
  }

  private func signature(_ dir: URL) -> String {
    let generation = (try? String(contentsOf: dir.appendingPathComponent("generation"), encoding: .utf8)) ?? "-"
    var st = stat()
    let ext = lstat(dir.appendingPathComponent("extension").path, &st) == 0 ? "\(st.st_ino):\(st.st_mode)" : "-"
    return "\(generation)|\(ext)"
  }

  func read() -> [String: Any] {
    guard let dir else { return ["state": "invalid", "error": "Ardia has no data folder"] }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let lock = open(dir.appendingPathComponent(".lock").path, O_RDONLY | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o644)
    guard lock >= 0 else { return ["state": "busy"] }
    defer { close(lock) }
    var locked = false
    for attempt in 0..<UserScripts.lockAttempts {
      if flock(lock, LOCK_SH | LOCK_NB) == 0 {
        locked = true
        break
      }
      if errno != EWOULDBLOCK || attempt == UserScripts.lockAttempts - 1 { break }
      usleep(UserScripts.lockRetryMicroseconds)
    }
    guard locked else { return ["state": "busy"] }
    defer { flock(lock, LOCK_UN) }

    var folder = snapshot(dir)
    folder["token"] = token(dir)
    return folder
  }

  private func token(_ dir: URL) -> String {
    var st = stat()
    let folder = lstat(dir.path, &st) == 0 ? "\(st.st_mtimespec.tv_sec).\(st.st_mtimespec.tv_nsec):\(st.st_ino)" : "-"
    let generation = (try? String(contentsOf: dir.appendingPathComponent("generation"), encoding: .utf8)) ?? "-"
    let ext = dir.appendingPathComponent("extension")
    let inner = (try? String(contentsOf: ext.appendingPathComponent("generation"), encoding: .utf8)) ?? "-"
    let node = lstat(ext.path, &st) == 0 ? "\(st.st_ino)" : "-"
    return "\(folder)|\(generation)|\(inner)|\(node)"
  }

  private func snapshot(_ dir: URL) -> [String: Any] {
    let path = realPath(dir.deletingLastPathComponent()) + "/Scripts/extension"
    let written = readGeneration(dir.appendingPathComponent("generation"))
    var st = stat()
    guard lstat(dir.path, &st) == 0, st.st_mode & S_IFMT == S_IFDIR else {
      return ["state": "invalid", "generation": written ?? 0, "path": path, "error": "Scripts isn't a plain folder"]
    }
    let ext = dir.appendingPathComponent("extension")
    guard lstat(ext.path, &st) == 0 else {
      return written.map { ["state": "absent", "generation": $0, "path": path] } ?? ["state": "empty"]
    }
    guard let inner = readGeneration(ext.appendingPathComponent("generation")) else { return ["state": "pending"] }
    guard inner >= (written ?? Int.min) else { return ["state": "pending", "generation": written ?? 0] }
    let generation = inner
    guard st.st_mode & S_IFMT == S_IFDIR else {
      return ["state": "invalid", "generation": generation, "path": path, "error": "Scripts/extension isn't a plain folder"]
    }
    do {
      try validate(ext)
    } catch let refused as Refused {
      return ["state": "invalid", "generation": generation, "path": path, "error": refused.message]
    } catch {
      return ["state": "invalid", "generation": generation, "path": path, "error": error.localizedDescription]
    }
    return ["state": "ready", "generation": generation, "path": path]
  }

  func readStatus() -> String? {
    guard let dir else { return nil }
    return try? String(contentsOf: dir.appendingPathComponent("status.json"), encoding: .utf8)
  }

  func writeStatus(_ json: String) throws {
    guard let dir else { throw Refused("Ardia has no data folder") }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try Data(json.utf8).write(to: dir.appendingPathComponent("status.json"), options: .atomic)
  }

  private func readGeneration(_ url: URL) -> Int? {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    return Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private func realPath(_ url: URL) -> String {
    guard let resolved = realpath(url.path, nil) else { return url.path }
    defer { free(resolved) }
    return String(cString: resolved)
  }

  private func validate(_ ext: URL) throws {
    let manifestPath = ext.appendingPathComponent("manifest.json").path
    var st = stat()
    guard lstat(manifestPath, &st) == 0, st.st_mode & S_IFMT == S_IFREG else { throw Refused("manifest.json is missing or isn't a plain file") }
    guard st.st_size <= UserScripts.manifestLimit else { throw Refused("manifest.json is too large") }
    guard let data = FileManager.default.contents(atPath: manifestPath),
      let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw Refused("manifest.json isn't a JSON object") }

    if let extra = Set(manifest.keys).subtracting(UserScripts.topKeys).sorted().first {
      throw Refused("manifest.json may not contain \"\(extra)\"")
    }
    guard let version = manifest["manifest_version"] as? NSNumber, !isBool(version), version.doubleValue == 3 else {
      throw Refused("manifest_version must be 3")
    }
    guard manifest["name"] is String else { throw Refused("name must be a string") }
    guard manifest["version"] is String else { throw Refused("version must be a string") }
    if let description = manifest["description"], !(description is String) { throw Refused("description must be a string") }
    guard let entries = manifest["content_scripts"] as? [Any] else { throw Refused("content_scripts must be a list") }

    for (index, item) in entries.enumerated() {
      let at = "content_scripts[\(index)]"
      guard let entry = item as? [String: Any] else { throw Refused("\(at) must be an object") }
      if let extra = Set(entry.keys).subtracting(UserScripts.entryKeys).sorted().first {
        throw Refused("\(at) may not contain \"\(extra)\"")
      }
      for key in UserScripts.stringListKeys {
        guard let value = entry[key] else { continue }
        guard let list = value as? [Any], list.allSatisfy({ $0 is String }) else { throw Refused("\(at).\(key) must be a list of strings") }
      }
      for key in UserScripts.flagKeys {
        guard let value = entry[key] else { continue }
        guard let flag = value as? NSNumber, isBool(flag) else { throw Refused("\(at).\(key) must be true or false") }
      }
      if let runAt = entry["run_at"], !((runAt as? String).map(UserScripts.runAts.contains) ?? false) {
        throw Refused("\(at).run_at must be document_start, document_end or document_idle")
      }
      if let world = entry["world"], !((world as? String).map(UserScripts.worlds.contains) ?? false) {
        throw Refused("\(at).world must be ISOLATED or MAIN")
      }
      for key in ["js", "css"] {
        for file in entry[key] as? [String] ?? [] { try checkFile(file, in: ext.path, at: "\(at).\(key)") }
      }
    }
  }

  private func isBool(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

  private func checkFile(_ relative: String, in root: String, at: String) throws {
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
    let malformed =
      relative.isEmpty || relative.contains("\0") || relative.contains("\\")
      || parts.contains { $0.isEmpty || $0 == "." || $0 == ".." }
    if malformed { throw Refused("\(at): \"\(relative)\" must be a plain relative path inside the extension") }
    var path = root
    for (index, part) in parts.enumerated() {
      path += "/" + part
      var st = stat()
      guard lstat(path, &st) == 0 else { throw Refused("\(at): \"\(relative)\" is missing") }
      let wanted = index == parts.count - 1 ? S_IFREG : S_IFDIR
      guard st.st_mode & S_IFMT == wanted else { throw Refused("\(at): \"\(relative)\" must be a plain file, not a link") }
    }
  }
}
