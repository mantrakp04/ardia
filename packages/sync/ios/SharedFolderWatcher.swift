import CoreServices
import Foundation

final class SharedFolderWatcher {
  private let queue = DispatchQueue(label: "ardia.shared-folders.watch", qos: .utility)
  private var stream: FSEventStreamRef?
  private var lastEvent = FSEventStreamEventId(kFSEventStreamEventIdSinceNow)
  private var roots: [(watched: String, real: String)] = []
  private let onChange: ([String]) -> Void

  init(onChange: @escaping ([String]) -> Void) {
    self.onChange = onChange
  }

  func watch(_ paths: [String]) {
    queue.async {
      let next = paths.map { (watched: $0, real: Self.resolved($0)) }
      guard next.map(\.real) != self.roots.map(\.real) || (self.stream == nil && !next.isEmpty) else {
        self.roots = next
        return
      }
      self.roots = next
      self.restart()
    }
  }

  func stop() {
    queue.async {
      self.roots = []
      self.stopStream()
    }
  }

  private static func resolved(_ path: String) -> String {
    guard let real = realpath(path, nil) else { return (path as NSString).standardizingPath }
    defer { free(real) }
    return String(cString: real)
  }

  private func restart() {
    stopStream()
    guard !roots.isEmpty else { return }
    var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
    let callback: FSEventStreamCallback = { _, info, _, paths, _, _ in
      guard let info else { return }
      let watcher = Unmanaged<SharedFolderWatcher>.fromOpaque(info).takeUnretainedValue()
      watcher.changed((unsafeBitCast(paths, to: NSArray.self) as? [String]) ?? [])
    }
    let flags = FSEventStreamCreateFlags(
      kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagUseCFTypes)
    guard
      let created = FSEventStreamCreate(
        nil, callback, &context, roots.map(\.real) as CFArray, lastEvent, 0.2, flags)
    else { return }
    FSEventStreamSetDispatchQueue(created, queue)
    FSEventStreamStart(created)
    stream = created
  }

  private func stopStream() {
    guard let stream else { return }
    let latest = FSEventStreamGetLatestEventId(stream)
    if latest != 0 { lastEvent = latest }
    FSEventStreamStop(stream)
    FSEventStreamInvalidate(stream)
    FSEventStreamRelease(stream)
    self.stream = nil
  }

  private func changed(_ paths: [String]) {
    let hit = roots.filter { root in
      paths.contains { $0 == root.real || $0.hasPrefix(root.real + "/") || root.real.hasPrefix($0 + "/") }
    }
    guard !hit.isEmpty else { return }
    let watched = hit.map(\.watched)
    DispatchQueue.main.async { self.onChange(watched) }
  }
}
