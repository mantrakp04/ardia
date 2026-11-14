import Foundation

public enum RowReorder {
  public static func index(movingRowAt source: Int, toOffset destination: Int) -> Int {
    destination > source ? destination - 1 : destination
  }

  public static func move(_ sources: IndexSet, toOffset destination: Int) -> (source: Int, index: Int)? {
    guard sources.count == 1, let source = sources.first else { return nil }
    let index = index(movingRowAt: source, toOffset: destination)
    return index == source ? nil : (source, index)
  }
}

public enum ListHighlight {
  public static func moved(from current: Int?, by delta: Int, count: Int) -> Int? {
    guard count > 0 else { return nil }
    guard let current else { return delta >= 0 ? 0 : count - 1 }
    return min(max(current + delta, 0), count - 1)
  }
}
