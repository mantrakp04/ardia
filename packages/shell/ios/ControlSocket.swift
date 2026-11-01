import AppKit
import Darwin
import Foundation

final class ControlSocket {
  static let shared = ControlSocket()
  static let socketName = "ArdiaControl.sock"
  static let lockName = "ArdiaControl.sock.lock"
  static let maxConnections = 16
  static let maxPathBytes = 103
  static let acceptsPerCallback = 8

  typealias Sink = (_ name: String, _ body: [String: Any]) -> Void

  private let queue = DispatchQueue(label: "ardia.control", qos: .userInitiated)
  private var sink: (owner: ObjectIdentifier, send: Sink)?
  private var listenFd: Int32 = -1
  private var lockFd: Int32 = -1
  private var acceptSource: DispatchSourceRead?
  private var bound: (path: String, device: dev_t, inode: ino_t)?
  private var connections: [Int: ControlConnection] = [:]
  private var nextConnection = 0
  private var generation = 0
  private var quitObserver: NSObjectProtocol?

  func attach(_ owner: AnyObject, send: @escaping Sink) {
    let id = ObjectIdentifier(owner)
    queue.sync { sink = (id, send) }
    if quitObserver == nil {
      quitObserver = NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { [weak self] _ in
        self?.queue.sync { self?.stopOnQueue() }
      }
    }
  }

  func detach(_ owner: AnyObject) {
    let id = ObjectIdentifier(owner)
    queue.async { [self] in
      guard sink?.owner == id else { return }
      sink = nil
      stopOnQueue()
    }
  }

  func start(_ done: @escaping ([String: Any]) -> Void) {
    queue.async { [self] in done(startOnQueue()) }
  }

  func stop(_ done: @escaping () -> Void) {
    queue.async { [self] in
      stopOnQueue()
      done()
    }
  }

  func reply(_ connection: Int, _ line: String, ticket: Int) {
    let data = Self.framed(line)
    queue.async { [self] in
      if let target = connections[connection] {
        target.reply(data, ticket: ticket)
      } else if ticket > 0 {
        sink?.send("onWritten", ["tickets": [ticket]])
      }
    }
  }

  func broadcast(_ targets: [Int], _ line: String) {
    let data = Self.framed(line)
    queue.async { [self] in
      for id in targets { connections[id]?.event(data) }
    }
  }

  private static func framed(_ line: String) -> Data {
    var data = Data(line.utf8)
    data.append(10)
    return data
  }

  private func status(_ state: String, reason: String? = nil, path: String = "") -> [String: Any] {
    var status: [String: Any] = ["state": state, "generation": generation, "path": path]
    if let reason { status["reason"] = reason }
    return status
  }

  private func refuse(_ reason: String, path: String = "") -> [String: Any] {
    NSLog("[control] the ardia command's socket didn't start: %@", reason)
    return status("off", reason: reason, path: path)
  }

  private func startOnQueue() -> [String: Any] {
    if let bound { return status("on", path: bound.path) }
    let dir: String
    do {
      dir = try DocumentStore.url(Self.socketName).deletingLastPathComponent().path
    } catch {
      return refuse("Ardia has no data folder.")
    }
    let path = (dir as NSString).appendingPathComponent(Self.socketName)
    if let problem = Self.unsafeFolder(dir) { return refuse(problem, path: path) }
    guard path.utf8.count <= Self.maxPathBytes else {
      return refuse("The socket path is longer than \(Self.maxPathBytes) bytes: \(path)", path: path)
    }
    let lock = Darwin.open((dir as NSString).appendingPathComponent(Self.lockName), O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard lock >= 0 else { return refuse("Couldn't open the socket's lock file (\(Self.errnoText())).", path: path) }
    guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
      Darwin.close(lock)
      return refuse("Another Ardia is serving this data folder.", path: path)
    }
    var old = stat()
    if lstat(path, &old) == 0 {
      guard (old.st_mode & S_IFMT) == S_IFSOCK else {
        Darwin.close(lock)
        return refuse("\(path) exists and isn't a socket, so it was left alone.", path: path)
      }
      unlink(path)
    }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
      Darwin.close(lock)
      return refuse("Couldn't make a socket (\(Self.errnoText())).", path: path)
    }
    Self.prepare(fd)
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
      let bytes = Array(path.utf8)
      raw.copyBytes(from: bytes)
      raw[bytes.count] = 0
    }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let previousMask = umask(0o177)
    let bindResult = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    umask(previousMask)
    var made = stat()
    guard bindResult == 0, listen(fd, Int32(Self.maxConnections)) == 0, lstat(path, &made) == 0 else {
      let text = Self.errnoText()
      Darwin.close(fd)
      Darwin.close(lock)
      return refuse("Couldn't listen on \(path) (\(text)).", path: path)
    }
    generation += 1
    listenFd = fd
    lockFd = lock
    bound = (path, made.st_dev, made.st_ino)
    let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
    source.setEventHandler { [weak self] in self?.acceptAll() }
    source.setCancelHandler { Darwin.close(fd) }
    acceptSource = source
    source.activate()
    return status("on", path: path)
  }

  private func stopOnQueue() {
    guard let bound else { return }
    self.bound = nil
    for connection in Array(connections.values) { connection.close() }
    connections.removeAll()
    acceptSource?.cancel()
    acceptSource = nil
    listenFd = -1
    var now = stat()
    if lstat(bound.path, &now) == 0, (now.st_mode & S_IFMT) == S_IFSOCK, now.st_dev == bound.device, now.st_ino == bound.inode {
      unlink(bound.path)
    }
    Darwin.close(lockFd)
    lockFd = -1
  }

  private func acceptAll() {
    for _ in 0..<Self.acceptsPerCallback where bound != nil {
      let fd = accept(listenFd, nil, nil)
      if fd < 0 { return }
      var uid: uid_t = 0
      var gid: gid_t = 0
      guard getpeereid(fd, &uid, &gid) == 0, uid == geteuid(), connections.count < Self.maxConnections else {
        Darwin.close(fd)
        continue
      }
      Self.prepare(fd)
      nextConnection += 1
      let generation = generation
      let connection = ControlConnection(
        id: nextConnection, fd: fd, queue: queue,
        onLine: { [weak self] connection, line in
          self?.sink?.send("onRequest", ["connection": connection.id, "generation": generation, "line": line])
        },
        onClose: { [weak self] connection in
          guard let self, self.connections.removeValue(forKey: connection.id) != nil else { return }
          self.sink?.send("onClose", ["connection": connection.id])
        },
        onWritten: { [weak self] tickets in self?.sink?.send("onWritten", ["tickets": tickets]) })
      connections[connection.id] = connection
      connection.open()
    }
  }

  private static func prepare(_ fd: Int32) {
    _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
    var on: Int32 = 1
    _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
  }

  private static func unsafeFolder(_ dir: String) -> String? {
    var info = stat()
    guard lstat(dir, &info) == 0 else { return "Couldn't read the data folder \(dir) (\(errnoText()))." }
    guard (info.st_mode & S_IFMT) == S_IFDIR else { return "The data folder \(dir) isn't a real folder." }
    guard info.st_uid == geteuid() else { return "The data folder \(dir) belongs to another user." }
    guard info.st_mode & (S_IWGRP | S_IWOTH) == 0 else { return "Others can write to the data folder \(dir)." }
    return nil
  }

  private static func errnoText() -> String {
    String(cString: strerror(errno))
  }
}
