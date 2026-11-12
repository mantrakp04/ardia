import Foundation

struct SwitchCheck: Equatable {
  enum Phase: String {
    case waiting
    case checking
    case found
    case upToDate
    case newerThanLatest
    case failed
  }

  enum Event: Equatable {
    case switched(channel: String)
    case started
    case found(version: String)
    case notFound(newerThanLatest: Bool)
    case finished(failed: Bool)
    case manualCheck
  }

  private(set) var phase: Phase?
  private(set) var channel: String?
  private(set) var version: String?
  private(set) var userAsked = false

  var pending: Bool { phase == .waiting || phase == .checking }
  var settled: Bool { phase != nil && !pending }

  mutating func handle(_ event: Event) {
    switch event {
    case .switched(let channel):
      self = SwitchCheck(phase: .waiting, channel: channel)
    case .started:
      guard phase == .waiting else { return }
      phase = .checking
    case .found(let version):
      guard phase == .checking else { return }
      phase = .found
      self.version = version
    case .notFound(let newerThanLatest):
      guard phase == .checking else { return }
      phase = newerThanLatest ? .newerThanLatest : .upToDate
    case .finished(let failed):
      guard phase == .checking else { return }
      phase = failed ? .failed : nil
    case .manualCheck:
      if pending { userAsked = true } else { self = SwitchCheck() }
    }
  }

  var report: [String: String]? {
    guard let phase, let channel else { return nil }
    var report = ["phase": phase.rawValue, "channel": channel]
    if let version { report["version"] = version }
    return report
  }
}
