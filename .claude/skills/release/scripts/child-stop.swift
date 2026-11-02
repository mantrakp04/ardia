import Darwin
import Foundation

let args = CommandLine.arguments
guard args.count == 4, let parent = pid_t(args[1]), let seconds = Double(args[3]) else {
  FileHandle.standardError.write("usage: child-stop <parent pid> <executable path prefix> <seconds>\n".data(using: .utf8)!)
  exit(2)
}
let prefix = args[2]
let deadline = Date().addingTimeInterval(seconds)
var children = [pid_t](repeating: 0, count: 4096)
var path = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
while Date() < deadline {
  let count = proc_listchildpids(parent, &children, Int32(children.count * MemoryLayout<pid_t>.size))
  for child in children.prefix(Int(max(count, 0))) where child > 0 {
    guard proc_pidpath(child, &path, UInt32(path.count)) > 0, String(cString: path).hasPrefix(prefix) else { continue }
    kill(child, SIGSTOP)
    print(child)
    exit(0)
  }
  usleep(500)
}
exit(1)
