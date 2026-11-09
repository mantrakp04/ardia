import Darwin
import Foundation

struct ControlOutput {
  static let maxBytes = 4 * 1024 * 1024
  static let maxWaitingEvents = 1000

  enum WriteResult { case drained, blocked, failed }

  private struct Chunk {
    var data: Data
    let event: Bool
    var ticket = 0
  }

  private var chunks: [Chunk] = []
  private var headStarted = false
  private var offset = 0
  private(set) var bytes = 0
  private(set) var waitingEvents = 0
  private(set) var dropped = 0
  private var finished: [Int] = []

  var isEmpty: Bool { chunks.isEmpty }

  mutating func addReply(_ data: Data, ticket: Int) -> Bool {
    append(Chunk(data: data, event: false, ticket: ticket))
  }

  mutating func takeFinishedTickets() -> [Int] {
    defer { finished = [] }
    return finished
  }

  var waitingTickets: [Int] { chunks.map(\.ticket).filter { $0 > 0 } }

  mutating func addEvent(_ data: Data) -> Bool {
    if waitingEvents >= Self.maxWaitingEvents, let index = oldestWaitingEvent() {
      bytes -= chunks[index].data.count
      chunks.remove(at: index)
      waitingEvents -= 1
      dropped += 1
    }
    waitingEvents += 1
    return append(Chunk(data: data, event: true))
  }

  mutating func write(to fd: Int32) -> WriteResult {
    while !chunks.isEmpty {
      guard startHead() else { return .failed }
      let data = chunks[0].data
      let written = data.withUnsafeBytes { raw -> Int in
        guard let base = raw.baseAddress else { return 0 }
        return Darwin.write(fd, base + offset, data.count - offset)
      }
      if written < 0 {
        if errno == EINTR { continue }
        return errno == EAGAIN || errno == EWOULDBLOCK ? .blocked : .failed
      }
      offset += written
      bytes -= written
      if offset == data.count {
        if chunks[0].ticket > 0 { finished.append(chunks[0].ticket) }
        chunks.removeFirst()
        offset = 0
        headStarted = false
      }
    }
    return .drained
  }

  private mutating func append(_ chunk: Chunk) -> Bool {
    guard bytes + chunk.data.count <= Self.maxBytes else { return false }
    bytes += chunk.data.count
    chunks.append(chunk)
    return true
  }

  private func oldestWaitingEvent() -> Int? {
    chunks.indices.first { chunks[$0].event && !($0 == 0 && headStarted) }
  }

  private mutating func startHead() -> Bool {
    guard !headStarted else { return true }
    headStarted = true
    guard chunks[0].event else { return true }
    waitingEvents -= 1
    guard dropped > 0 else { return true }
    let marked = Self.marking(chunks[0].data, dropped: dropped)
    let grown = marked.count - chunks[0].data.count
    guard bytes + grown <= Self.maxBytes else { return false }
    bytes += grown
    chunks[0].data = marked
    dropped = 0
    return true
  }

  static func marking(_ line: Data, dropped: Int) -> Data {
    guard line.count >= 2, line.first == UInt8(ascii: "{"), line[line.startIndex + 1] != UInt8(ascii: "}") else { return line }
    var marked = Data("{\"dropped\":\(dropped),".utf8)
    marked.append(line.dropFirst())
    return marked
  }
}
