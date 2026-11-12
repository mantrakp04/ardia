import SwiftUI

public struct SettingsIconTile: View {
  public var systemImage: String
  public var color: Color
  public var baseSide: CGFloat

  @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

  public init(systemImage: String, color: Color, baseSide: CGFloat = SettingsTile.side) {
    self.systemImage = systemImage
    self.color = color
    self.baseSide = baseSide
  }

  private var side: CGFloat { baseSide * min(scale, 1.6) }

  public var body: some View {
    Image(systemName: systemImage)
      .font(.system(size: side * 0.52, weight: .medium))
      .symbolRenderingMode(.monochrome)
      .foregroundStyle(.white)
      .frame(width: side, height: side)
      .background(color.gradient, in: .rect(cornerRadius: side * 0.26, style: .continuous))
      .accessibilityHidden(true)
  }
}

#Preview {
  HStack {
    SettingsIconTile(systemImage: "hand.raised.fill", color: SettingsTint.ads)
    SettingsIconTile(systemImage: "eye.slash.fill", color: SettingsTint.trackers)
    SettingsIconTile(systemImage: "macbook.and.iphone", color: SettingsTint.sync, baseSide: 64)
  }
}
