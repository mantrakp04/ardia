import SwiftUI

public extension RectangleCornerRadii {
  init(uniform radius: CGFloat) {
    self.init(topLeading: radius, bottomLeading: radius, bottomTrailing: radius, topTrailing: radius)
  }

  var largest: CGFloat { Swift.max(topLeading, bottomLeading, bottomTrailing, topTrailing) }

  func concentric(inset: CGFloat) -> RectangleCornerRadii {
    RectangleCornerRadii(
      topLeading: Swift.max(0, topLeading - inset),
      bottomLeading: Swift.max(0, bottomLeading - inset),
      bottomTrailing: Swift.max(0, bottomTrailing - inset),
      topTrailing: Swift.max(0, topTrailing - inset)
    )
  }
}

public struct WindowMetrics: Equatable, Sendable {
  public let size: CGSize
  public let cornerRadii: RectangleCornerRadii

  public init(size: CGSize, cornerRadii: RectangleCornerRadii) {
    self.size = size
    self.cornerRadii = cornerRadii
  }

  public init(_ proxy: GeometryProxy) {
    self.init(size: proxy.size, cornerRadii: proxy.concentricCornerRadii ?? RectangleCornerRadii(uniform: 0))
  }

  public var layout: ChromeLayout { ChromeLayout(windowSize: size) }
}

public extension View {
  func windowCornerShape(inset: CGFloat = 0) -> some View {
    modifier(WindowCornerClip(inset: inset))
  }
}

private struct WindowCornerClip: ViewModifier {
  let inset: CGFloat
  @Environment(\.windowCornerRadii) private var radii

  func body(content: Content) -> some View {
    content.clipShape(UnevenRoundedRectangle(cornerRadii: radii.concentric(inset: inset), style: .continuous))
  }
}
