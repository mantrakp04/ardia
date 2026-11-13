import CoreGraphics

public enum KeyboardLift {
  public static let softwareKeyboardMinimum: CGFloat = 120

  public static func overlap(guideFrame: CGRect, containerHeight: CGFloat) -> CGFloat {
    guard !guideFrame.isNull, !guideFrame.isEmpty else { return 0 }
    return max(0, min(containerHeight, containerHeight - guideFrame.minY))
  }

  public static func isSoftwareKeyboardUp(_ overlap: CGFloat) -> Bool {
    overlap > softwareKeyboardMinimum
  }

  public static func lift(overlap: CGFloat, safeBottom: CGFloat, restsWithoutKeyboard: Bool) -> CGFloat {
    restsWithoutKeyboard ? max(overlap, safeBottom) : overlap
  }
}
