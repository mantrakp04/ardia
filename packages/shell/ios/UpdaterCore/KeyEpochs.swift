import Foundation

struct KeyEpochs {
  private var epochs: [Int: Int] = [:]
  private var lastKey: Int?

  func epoch(of window: Int) -> Int { epochs[window] ?? 0 }

  mutating func becameKey(_ window: Int) {
    if let lastKey, lastKey != window { epochs[window, default: 0] += 1 }
    lastKey = window
  }
}
