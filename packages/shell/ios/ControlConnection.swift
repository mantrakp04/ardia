import Darwin
import Foundation

final class ControlConnection {
  static let maxLine = 1_048_576
  static let maxPendingRequests = 32
  static let lineDeadline: TimeInterval = 30
  private static let readSize = 65536

  let id: Int
  private let fd: Int32
  private let queue: DispatchQueue
  private let onLine: (ControlConnection, String) -> Void
  private let onClose: (ControlConnection) -> Void
  private let onWritten: ([Int]) -> Void
  private var readSource: DispatchSourceRead?
  private var writeSource: DispatchSourceWrite?
  private var writeArmed = false
  private var openSources = 0
  private var input: [UInt8] = []
  private var output = ControlOutput()
  private var pendingRequests = 0
  private var deadline: DispatchWorkItem?
  private(set) var closed = false

  init(
    id: Int, fd: Int32, queue: DispatchQueue, onLine: @escaping (ControlConnection, String) -> Void,
    onClose: @escaping (ControlConnection) -> Void, onWritten: @escaping ([Int]) -> Void
  ) {
    self.id = id
    self.fd = fd
    self.queue = queue
    self.onLine = onLine
    self.onClose = onClose
    self.onWritten = onWritten
  }

  func open() {
    let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
    source.setEventHandler { [weak self] in self?.readAvailable() }
    adopt(source)
    readSource = source
    source.activate()
  }

  func reply(_ data: Data, ticket: Int) {
    guard !closed else { return report(ticket > 0 ? [ticket] : []) }
    pendingRequests = max(0, pendingRequests - 1)
    guard output.addReply(data, ticket: ticket) else {
      report(ticket > 0 ? [ticket] : [])
      return close()
    }
    if !writeArmed { flush() }
  }

  func event(_ data: Data) {
    guard !closed else { return }
    enqueue(output.addEvent(data))
  }

  func close() {
    guard !closed else { return }
    closed = true
    deadline?.cancel()
    deadline = nil
    if let writeSource {
      if !writeArmed { writeSource.resume() }
      writeSource.cancel()
    }
    readSource?.cancel()
    let unwritten = output.takeFinishedTickets() + output.waitingTickets
    output = ControlOutput()
    input = []
    onClose(self)
    report(unwritten)
  }

  private func report(_ tickets: [Int]) {
    if !tickets.isEmpty { onWritten(tickets) }
  }

  private func adopt(_ source: DispatchSourceProtocol) {
    openSources += 1
    source.setCancelHandler { [self] in
      openSources -= 1
      if openSources == 0 { Darwin.close(fd) }
    }
  }

  private func enqueue(_ accepted: Bool) {
    guard accepted else { return close() }
    if !writeArmed { flush() }
  }

  private func flush() {
    let result = output.write(to: fd)
    report(output.takeFinishedTickets())
    switch result {
    case .drained:
      disarmWrite()
    case .blocked:
      armWrite()
    case .failed:
      close()
    }
  }

  private func armWrite() {
    guard !writeArmed else { return }
    writeArmed = true
    if let writeSource {
      writeSource.resume()
      return
    }
    let source = DispatchSource.makeWriteSource(fileDescriptor: fd, queue: queue)
    source.setEventHandler { [weak self] in self?.flush() }
    adopt(source)
    writeSource = source
    source.activate()
  }

  private func disarmWrite() {
    guard writeArmed, let writeSource else { return }
    writeArmed = false
    writeSource.suspend()
  }

  private func readAvailable() {
    guard !closed else { return }
    var buffer = [UInt8](repeating: 0, count: Self.readSize)
    let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, Self.readSize) }
    if count > 0 { return take(buffer[0..<count]) }
    if count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) { return }
    close()
  }

  private func take(_ bytes: ArraySlice<UInt8>) {
    let scanFrom = input.count
    input.append(contentsOf: bytes)
    var lineStart = 0
    var index = scanFrom
    var consumed = false
    while let newline = input[index...].firstIndex(of: 10) {
      let length = newline - lineStart
      guard length <= Self.maxLine else { return close() }
      pendingRequests += 1
      guard pendingRequests <= Self.maxPendingRequests else { return close() }
      onLine(self, String(decoding: input[lineStart..<newline], as: UTF8.self))
      if closed { return }
      lineStart = newline + 1
      index = lineStart
      consumed = true
    }
    if lineStart > 0 { input.removeFirst(lineStart) }
    guard input.count <= Self.maxLine else { return close() }
    if input.isEmpty || consumed {
      deadline?.cancel()
      deadline = nil
    }
    if !input.isEmpty && deadline == nil { armDeadline() }
  }

  private func armDeadline() {
    let item = DispatchWorkItem { [weak self] in
      guard let self, !self.closed, !self.input.isEmpty else { return }
      self.close()
    }
    deadline = item
    queue.asyncAfter(deadline: .now() + Self.lineDeadline, execute: item)
  }
}

