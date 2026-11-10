import Foundation

struct ScrollRange: Equatable {
  var lowest: Double
  var highest: Double

  var room: Double { highest - lowest }

  func clamped(_ value: Double) -> Double { min(max(value, lowest), highest) }
}

struct WheelTick: Equatable {
  var deltaX: Double
  var deltaY: Double
  var precise: Bool
  var phased: Bool
}

enum WheelAxis {
  static let pointsPerLine = 40.0
  static let smallestRoom = 0.5

  static func sidewaysOffset(for tick: WheelTick, at offset: Double, horizontal: ScrollRange, vertical: ScrollRange) -> Double? {
    guard !tick.phased, tick.deltaX == 0, tick.deltaY != 0 else { return nil }
    guard horizontal.room > smallestRoom, vertical.room <= smallestRoom else { return nil }
    let points = tick.precise ? tick.deltaY : tick.deltaY * pointsPerLine
    return horizontal.clamped(offset - points)
  }
}

final class WheelTally {
  static let strip = WheelTally()

  private let lock = NSLock()
  private var ticks = 0
  private var moved = 0

  func note(from offset: Double, to target: Double) {
    lock.lock()
    defer { lock.unlock() }
    ticks += 1
    if target != offset { moved += 1 }
  }

  func take() -> (ticks: Int, moved: Int) {
    lock.lock()
    defer { lock.unlock() }
    let taken = (ticks: ticks, moved: moved)
    ticks = 0
    moved = 0
    return taken
  }
}
