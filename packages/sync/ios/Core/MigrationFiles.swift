import Foundation

enum MigrationFiles {
  static func writeDurably(_ data: Data?, to url: URL, mode: mode_t, fullSync: Bool = false) -> Bool {
    guard let data else { return false }
    let temp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).\(getpid()).tmp")
    unlink(temp.path)
    let fd = open(temp.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, mode)
    guard fd >= 0 else { return false }
    let wrote = fchmod(fd, mode) == 0 && data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) } == data.count
    let synced = fullSync ? fcntl(fd, F_FULLFSYNC) == 0 : fsync(fd) == 0
    close(fd)
    guard wrote, synced, rename(temp.path, url.path) == 0 else {
      unlink(temp.path)
      return false
    }
    syncFolder(url.deletingLastPathComponent(), full: fullSync)
    return true
  }

  static func syncFolder(_ url: URL, full: Bool = true) {
    let fd = open(url.path, O_RDONLY | O_CLOEXEC)
    guard fd >= 0 else { return }
    if !full || fcntl(fd, F_FULLFSYNC) != 0 { fsync(fd) }
    close(fd)
  }
}
