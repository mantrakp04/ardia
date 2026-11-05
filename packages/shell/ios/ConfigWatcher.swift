import CoreServices
import Foundation

final class ConfigWatcher {
  static let shared = ConfigWatcher()

  private struct Targets: Equatable {
    var folder: String?
    var exact: Set<String> = []
    var streamed: [String] = []
    var topology = ""
  }

  private let queue = DispatchQueue(label: "ardia.config-watch", qos: .utility)
  private var stream: FSEventStreamRef?
  private var topologySource: DispatchSourceFileSystemObject?
  private var targets = Targets()
  private var names: [String] = []
  private var onChange: (() -> Void)?

  func watch(_ names: [String], armed: @escaping () -> Void, onChange: @escaping () -> Void) {
    queue.async {
      self.names = names.filter(ConfigFolder.isWatchable)
      self.onChange = onChange
      self.rebuild(force: true)
      DispatchQueue.main.async(execute: armed)
    }
  }

  func stop() {
    queue.async {
      self.onChange = nil
      self.stopStream()
      self.topologySource?.cancel()
      self.topologySource = nil
      self.targets = Targets()
    }
  }

  private static func resolved(_ path: String) -> String? {
    guard let real = realpath(path, nil) else { return nil }
    defer { free(real) }
    return String(cString: real)
  }

  private static func nearestExisting(_ path: String) -> String {
    var at = path
    while !FileManager.default.fileExists(atPath: at), at != "/" { at = (at as NSString).deletingLastPathComponent }
    return at
  }

  private func computeTargets() -> Targets {
    let lexical = ConfigFolder.directory
    var next = Targets()
    next.folder = Self.resolved(lexical)
    next.topology = Self.nearestExisting((lexical as NSString).deletingLastPathComponent)
    guard let folder = next.folder else { return next }
    var streamed: Set<String> = [folder]
    for name in names {
      let entry = (folder as NSString).appendingPathComponent(name)
      next.exact.insert(entry)
      var parent = (entry as NSString).deletingLastPathComponent
      while parent != folder, parent.hasPrefix(folder + "/") {
        next.exact.insert(parent)
        if let real = Self.resolved(parent) {
          next.exact.insert(real)
          streamed.insert((real as NSString).deletingLastPathComponent)
        }
        parent = (parent as NSString).deletingLastPathComponent
      }
      if let real = Self.resolved(entry) {
        next.exact.insert(real)
        streamed.insert((real as NSString).deletingLastPathComponent)
      }
    }
    let sorted = streamed.sorted()
    next.streamed = sorted.filter { path in !sorted.contains { $0 != path && path.hasPrefix($0 + "/") } }
    return next
  }

  @discardableResult
  private func rebuild(force: Bool = false) -> Targets {
    let before = targets
    let next = computeTargets()
    targets = next
    if force || next.streamed != before.streamed {
      stopStream()
      startStream()
    }
    if force || next.topology != before.topology || topologySource == nil { startTopology() }
    return before
  }

  private func startTopology() {
    topologySource?.cancel()
    topologySource = nil
    let fd = open(targets.topology, O_EVTONLY | O_CLOEXEC)
    guard fd >= 0 else { return }
    let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .delete, .rename, .link], queue: queue)
    source.setEventHandler { [weak self] in self?.topologyChanged() }
    source.setCancelHandler { close(fd) }
    topologySource = source
    source.resume()
  }

  private func topologyChanged() {
    let before = rebuild()
    if before.folder != targets.folder { notify() }
  }

  private func stopStream() {
    guard let stream else { return }
    FSEventStreamStop(stream)
    FSEventStreamInvalidate(stream)
    FSEventStreamRelease(stream)
    self.stream = nil
  }

  private func startStream() {
    guard !targets.streamed.isEmpty else { return }
    var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
    let callback: FSEventStreamCallback = { _, info, count, paths, flags, _ in
      guard let info else { return }
      let watcher = Unmanaged<ConfigWatcher>.fromOpaque(info).takeUnretainedValue()
      let changed = (unsafeBitCast(paths, to: NSArray.self) as? [String]) ?? []
      let rootChanged = (0..<count).contains { flags[$0] & FSEventStreamEventFlags(kFSEventStreamEventFlagRootChanged) != 0 }
      watcher.streamChanged(changed, rootChanged: rootChanged)
    }
    let flags = FSEventStreamCreateFlags(
      kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagUseCFTypes)
    guard
      let created = FSEventStreamCreate(
        nil, callback, &context, targets.streamed as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.05, flags)
    else { return }
    FSEventStreamSetDispatchQueue(created, queue)
    FSEventStreamStart(created)
    stream = created
  }

  private func streamChanged(_ paths: [String], rootChanged: Bool) {
    let before = rebuild()
    let relevant = before.exact.union(targets.exact)
    if rootChanged || before.folder != targets.folder || paths.contains(where: relevant.contains) { notify() }
  }

  private func notify() {
    guard let onChange else { return }
    DispatchQueue.main.async(execute: onChange)
  }
}
