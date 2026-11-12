import CoreGraphics

public enum TrayDrag {
  public static let upwardLimit: CGFloat = 36
  public static let flickVelocity: CGFloat = 800
  public static let returnVelocity: CGFloat = -250
  public static let momentum: CGFloat = 0.12
  public static let distanceShare: CGFloat = 0.35
  public static let distanceCap: CGFloat = 120
  public static let keyboardRelease: CGFloat = 8

  public static func offset(for translation: CGFloat) -> CGFloat {
    guard translation < 0 else { return translation }
    return -rubberBand(-translation, limit: upwardLimit)
  }

  public static func rubberBand(_ distance: CGFloat, limit: CGFloat) -> CGFloat {
    guard distance > 0, limit > 0 else { return 0 }
    return limit * (1 - 1 / (distance / limit + 1))
  }

  public static func dismissDistance(trayHeight: CGFloat) -> CGFloat {
    min(max(trayHeight, 0) * distanceShare, distanceCap)
  }

  public static func shouldDismiss(translation: CGFloat, velocity: CGFloat, trayHeight: CGFloat) -> Bool {
    guard translation > 0 else { return false }
    if velocity <= returnVelocity { return false }
    if velocity >= flickVelocity { return true }
    return translation + max(velocity, 0) * momentum >= dismissDistance(trayHeight: trayHeight)
  }

  public static func releasesKeyboard(translation: CGFloat) -> Bool {
    translation > keyboardRelease
  }

  public static func progress(offset: CGFloat, travel: CGFloat) -> CGFloat {
    guard travel > 0 else { return 0 }
    return min(max(offset / travel, 0), 1)
  }
}
