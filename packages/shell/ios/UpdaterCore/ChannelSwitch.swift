import Foundation

struct ChannelSwitch {
  struct Copy: Hashable {
    let folder: String
    let device: UInt64
    let inode: UInt64
    let build: String

    var residue: Residue { Residue(folder: folder, device: device, inode: inode) }
  }

  struct Residue: Hashable {
    let folder: String
    let device: UInt64
    let inode: UInt64
  }

  struct Sighting: Equatable {
    var copies: Set<Copy> = []
    var residue: Set<Residue> = []
    var blind = false
  }

  enum Staged: Equatable {
    case none
    case present(Set<Copy>)
    case unreadable
  }

  struct Facts: Equatable {
    var busy: Bool
    var staged: Staged
    var automaticChecks: Bool
  }

  struct Round: Equatable {
    var cancelled: Set<Copy> = []
    var cancelledBuilds: Set<String> = []
    var switched = false
  }

  enum Phase: Equatable {
    case idle
    case waitingForIdle(Round)
    case resuming(Round)
    case cancelling(Round)
    case unconfirmed

    var round: Round? {
      switch self {
      case .waitingForIdle(let round), .resuming(let round), .cancelling(let round): return round
      case .idle, .unconfirmed: return nil
      }
    }

    func with(_ round: Round) -> Phase {
      switch self {
      case .waitingForIdle: return .waitingForIdle(round)
      case .resuming: return .resuming(round)
      case .cancelling: return .cancelling(round)
      case .idle, .unconfirmed: return self
      }
    }
  }

  enum Effect: Equatable {
    case resume
    case resetCycle
    case watch
    case unwatch
    case release([Int])
    case log(String)
  }

  private(set) var phase = Phase.idle
  private(set) var waiting: [Int] = []
  private(set) var known: Set<Copy> = []
  private(set) var last: Facts?
  private var roundWanted = false

  var wantsFacts: Bool { phase != .idle || !waiting.isEmpty || roundWanted }

  func holdsQuit(_ facts: Facts) -> Bool {
    facts.staged != .none || (phase != .idle && facts.busy)
  }

  mutating func observe(_ sighting: Sighting, busy: Bool, automaticChecks: Bool) -> Facts {
    let kept = sighting.blind ? known : known.filter { sighting.residue.contains($0.residue) }
    known = sighting.copies.union(kept)
    let unknown = sighting.residue.subtracting(known.map(\.residue))
    let blind = sighting.blind || !unknown.isEmpty
    let facts = Facts(busy: busy, staged: known.isEmpty ? (blind ? .unreadable : .none) : .present(known), automaticChecks: automaticChecks)
    last = facts
    return facts
  }

  mutating func switched() -> [Effect] {
    switch phase {
    case .idle:
      phase = .waitingForIdle(Round(switched: true))
      return []
    case .waitingForIdle(var round):
      round.switched = true
      phase = .waitingForIdle(round)
      return []
    case .resuming(var round):
      round.switched = true
      phase = .resuming(round)
      return []
    case .cancelling(var round):
      round.switched = true
      phase = .waitingForIdle(round)
      return [.unwatch]
    case .unconfirmed:
      phase = .waitingForIdle(Round(switched: true))
      return [.unwatch]
    }
  }

  mutating func installerCancelled(build: String) -> [Effect] {
    switch phase {
    case .idle:
      phase = .waitingForIdle(Round(cancelledBuilds: [build]))
      return []
    case .unconfirmed:
      phase = .waitingForIdle(Round(cancelledBuilds: [build]))
      return [.unwatch]
    case .waitingForIdle(var round), .resuming(var round), .cancelling(var round):
      round.cancelledBuilds.insert(build)
      phase = phase.with(round)
      return []
    }
  }

  mutating func quit(_ id: Int) {
    waiting.append(id)
    roundWanted = true
  }

  mutating func changed(_ facts: Facts) -> [Effect] {
    last = facts
    var effects: [Effect] = []
    if var round = phase.round, !round.cancelledBuilds.isEmpty {
      switch facts.staged {
      case .present(let copies):
        round.cancelled.formUnion(copies.filter { round.cancelledBuilds.contains($0.build) })
        round.cancelledBuilds = []
      case .none:
        round.cancelledBuilds = []
      case .unreadable:
        break
      }
      phase = phase.with(round)
    }
    if roundWanted {
      roundWanted = false
      if facts.staged != .none {
        switch phase {
        case .idle:
          phase = .waitingForIdle(Round())
        case .unconfirmed:
          phase = .waitingForIdle(Round())
          effects.append(.unwatch)
        case .waitingForIdle, .resuming, .cancelling:
          break
        }
      }
    }
    effects += advance(facts)
    if !waiting.isEmpty, !holdsQuit(facts) {
      effects.append(.release(waiting))
      waiting = []
    }
    return effects
  }

  private mutating func advance(_ facts: Facts) -> [Effect] {
    switch phase {
    case .idle:
      return []
    case .waitingForIdle(let round):
      guard !facts.busy else { return [] }
      switch facts.staged {
      case .none:
        return settle(facts, reset: round.switched)
      case .present(let copies) where copies.isSubset(of: round.cancelled):
        phase = .cancelling(round)
        return [.watch]
      case .present, .unreadable:
        phase = .resuming(round)
        return [.resume]
      }
    case .resuming(let round):
      guard !facts.busy else { return [] }
      switch facts.staged {
      case .none:
        return settle(facts, reset: round.switched)
      case .present(let copies) where copies.isSubset(of: round.cancelled):
        phase = .cancelling(round)
        return [.watch]
      case .unreadable where !round.cancelled.isEmpty || !round.cancelledBuilds.isEmpty:
        phase = .cancelling(round)
        return [.watch]
      case .present:
        phase = .unconfirmed
        return [.watch, .log("Sparkle's installer didn't confirm dropping the staged nightly; quitting waits for its deadline")]
      case .unreadable:
        phase = .unconfirmed
        return [.watch, .log("Sparkle's cache can't be read to confirm the staged nightly is gone; quitting waits for its deadline")]
      }
    case .cancelling(let round):
      switch facts.staged {
      case .none:
        return [.unwatch] + settle(facts, reset: round.switched)
      case .present(let copies) where copies.isSubset(of: round.cancelled):
        return []
      case .unreadable:
        return []
      case .present:
        guard !facts.busy else { return [] }
        phase = .resuming(round)
        return [.unwatch, .resume]
      }
    case .unconfirmed:
      guard facts.staged == .none else { return [] }
      return [.unwatch] + settle(facts, reset: false)
    }
  }

  mutating func deadline(_ id: Int) -> [Effect] {
    guard let index = waiting.firstIndex(of: id) else { return [] }
    waiting.remove(at: index)
    switch last?.staged {
    case .none?, nil:
      return [.release([id])]
    case .present?:
      return [.log("Sparkle didn't drop the staged nightly before the quit deadline; quitting, and it may install"), .release([id])]
    case .unreadable?:
      return [.log("Sparkle's cache can't be read at the quit deadline; quitting, and a staged nightly may install"), .release([id])]
    }
  }

  private mutating func settle(_ facts: Facts, reset: Bool) -> [Effect] {
    phase = .idle
    let released = waiting
    waiting = []
    return (reset && facts.automaticChecks ? [.resetCycle] : []) + (released.isEmpty ? [] : [.release(released)])
  }
}
