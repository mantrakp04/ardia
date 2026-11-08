import Darwin
import Foundation

final class VaultCommand: @unchecked Sendable {
  static let outputLimit = 32 * 1024 * 1024
  static let errorLimit = 1024 * 1024
  static let killDelay: TimeInterval = 2
  static let drainDelay: TimeInterval = 2

  private let executable: String
  private let arguments: [String]
  private let environment: [String: String]
  private let input: Data?
  private let timeout: TimeInterval
  private let onOutput: (@Sendable (String) -> Void)?
  private let queue = DispatchQueue(label: "dev.ardia.vaults.command")
  private let lock = NSLock()

  private var process: Process?
  private var outputPipe: Pipe?
  private var errorPipe: Pipe?
  private var timer: DispatchSourceTimer?
  private var completion: (@Sendable (VaultCommandResult) -> Void)?
  private var output = Data()
  private var errors = Data()
  private var outputClosed = false
  private var errorsClosed = false
  private var exitStatus: Int32?
  private var started = false
  private var finished = false
  private var timedOut = false
  private var cancelled = false
  private var overflowed = false

  init(executable: String, arguments: [String], environment: [String: String], input: Data?, timeout: TimeInterval,
       onOutput: (@Sendable (String) -> Void)? = nil) {
    self.executable = executable
    self.arguments = arguments
    self.environment = environment
    self.input = input
    self.timeout = timeout
    self.onOutput = onOutput
  }

  func run() async -> VaultCommandResult {
    await withCheckedContinuation { continuation in
      start { continuation.resume(returning: $0) }
    }
  }

  func start(_ completion: @escaping @Sendable (VaultCommandResult) -> Void) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = environment
    process.currentDirectoryURL = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    let outputPipe = Pipe()
    let errorPipe = Pipe()
    let inputPipe: Pipe? = input == nil ? nil : Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe
    if let inputPipe {
      process.standardInput = inputPipe
    } else {
      process.standardInput = FileHandle.nullDevice
    }

    lock.lock()
    if started {
      lock.unlock()
      return completion(.notLaunched)
    }
    started = true
    self.process = process
    self.outputPipe = outputPipe
    self.errorPipe = errorPipe
    self.completion = completion
    lock.unlock()

    outputPipe.fileHandleForReading.readabilityHandler = { handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        self.closed(errors: false)
      } else {
        self.received(data, errors: false)
      }
    }
    errorPipe.fileHandleForReading.readabilityHandler = { handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        self.closed(errors: true)
      } else {
        self.received(data, errors: true)
      }
    }
    process.terminationHandler = { ended in self.exited(ended.terminationStatus) }

    do {
      try process.run()
    } catch {
      process.terminationHandler = nil
      finish(launched: false)
      return
    }

    if let inputPipe, let input {
      let handle = inputPipe.fileHandleForWriting
      queue.async { Self.feed(input, to: handle) }
    }

    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + timeout)
    timer.setEventHandler { self.stop(timedOut: true) }
    timer.resume()
    lock.lock()
    let alreadyFinished = finished
    if !alreadyFinished { self.timer = timer }
    lock.unlock()
    if alreadyFinished { timer.cancel() }
  }

  func cancel() { stop(timedOut: false) }

  private func stop(timedOut: Bool) {
    lock.lock()
    guard started, !finished, exitStatus == nil, let process = self.process else {
      lock.unlock()
      return
    }
    if timedOut { self.timedOut = true } else { cancelled = true }
    lock.unlock()
    halt(process)
  }

  private func halt(_ process: Process) {
    if process.isRunning { process.terminate() }
    let pid = process.processIdentifier
    queue.asyncAfter(deadline: .now() + Self.killDelay) {
      self.lock.lock()
      let exited = self.exitStatus != nil
      self.lock.unlock()
      if !exited && process.isRunning { kill(pid, SIGKILL) }
    }
  }

  private func received(_ data: Data, errors isErrors: Bool) {
    var snapshot: String?
    var runaway: Process?
    lock.lock()
    if isErrors {
      let room = Self.errorLimit - errors.count
      if room > 0 { errors.append(data.prefix(room)) }
    } else if output.count + data.count > Self.outputLimit {
      if !overflowed && exitStatus == nil {
        overflowed = true
        runaway = process
      }
    } else {
      output.append(data)
      if onOutput != nil { snapshot = String(decoding: output, as: UTF8.self) }
    }
    lock.unlock()
    if let runaway { halt(runaway) }
    if let snapshot { onOutput?(snapshot) }
  }

  private func closed(errors isErrors: Bool) {
    lock.lock()
    if isErrors { errorsClosed = true } else { outputClosed = true }
    let ready = exitStatus != nil && outputClosed && errorsClosed
    lock.unlock()
    if ready { finish(launched: true) }
  }

  private func exited(_ status: Int32) {
    lock.lock()
    exitStatus = status
    let ready = outputClosed && errorsClosed
    lock.unlock()
    if ready {
      finish(launched: true)
    } else {
      queue.asyncAfter(deadline: .now() + Self.drainDelay) { self.finish(launched: true) }
    }
  }

  private func finish(launched: Bool) {
    lock.lock()
    if finished {
      lock.unlock()
      return
    }
    finished = true
    let result = VaultCommandResult(
      status: exitStatus ?? -1, stdout: output, stderr: String(decoding: errors, as: UTF8.self), launched: launched,
      timedOut: timedOut, cancelled: cancelled, overflowed: overflowed)
    let completion = self.completion
    let timer = self.timer
    let outputPipe = self.outputPipe
    let errorPipe = self.errorPipe
    self.completion = nil
    self.timer = nil
    self.outputPipe = nil
    self.errorPipe = nil
    self.process = nil
    output = Data()
    errors = Data()
    lock.unlock()

    timer?.cancel()
    for pipe in [outputPipe, errorPipe].compactMap({ $0 }) {
      pipe.fileHandleForReading.readabilityHandler = nil
      try? pipe.fileHandleForReading.close()
    }
    completion?(result)
  }

  private static func feed(_ data: Data, to handle: FileHandle) {
    let descriptor = handle.fileDescriptor
    _ = fcntl(descriptor, F_SETNOSIGPIPE, 1)
    data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
      guard let base = buffer.baseAddress else { return }
      var offset = 0
      while offset < buffer.count {
        let written = Darwin.write(descriptor, base + offset, buffer.count - offset)
        if written > 0 {
          offset += written
        } else if written < 0 && errno == EINTR {
          continue
        } else {
          break
        }
      }
    }
    try? handle.close()
  }
}
