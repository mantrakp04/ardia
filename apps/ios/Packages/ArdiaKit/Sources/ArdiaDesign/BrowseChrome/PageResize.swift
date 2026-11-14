import CoreGraphics

public enum PageResize {
  public static let threshold: CGFloat = 0.5
  public static let zoomTolerance: CGFloat = 0.01
  public static let layoutTolerance: CGFloat = 1
  public static let settleDelay = Tokens.Duration.fast / 3
  public static let paintDeadline = Tokens.Duration.long * 2
  public static let revealDeadline = Tokens.Duration.long
  public static let revealDuration = Tokens.Duration.fast

  public static func coversChange(from old: CGSize, to new: CGSize) -> Bool {
    guard old.width > 0, old.height > 0, new.width > 0, new.height > 0 else { return false }
    return abs(new.width - old.width) >= threshold
  }

  public static func isStill(from old: CGSize, to new: CGSize) -> Bool {
    abs(new.width - old.width) < threshold && abs(new.height - old.height) < threshold
  }

  public static func scalesWithCard(minimumZoomScale: CGFloat) -> Bool {
    minimumZoomScale < 1 - zoomTolerance
  }

  public static func coverScale(from base: CGSize, to size: CGSize, scalesWithCard: Bool, reduceMotion: Bool = false) -> CGFloat {
    guard scalesWithCard, !reduceMotion, base.width > 0, base.height > 0 else { return 1 }
    return max(1, size.width / base.width, size.height / base.height)
  }

  public static func hasLaidOut(contentWidth: CGFloat, viewWidth: CGFloat) -> Bool {
    viewWidth > 0 && abs(contentWidth - viewWidth) <= layoutTolerance
  }

  public static func hasRelaidOut(contentWidth: CGFloat, startWidth: CGFloat) -> Bool {
    abs(contentWidth - startWidth) > layoutTolerance
  }
}
