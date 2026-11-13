import SwiftUI

public enum Tokens {
  public enum Space {
    public static let xxs: CGFloat = 2
    public static let xs: CGFloat = 4
    public static let s: CGFloat = 6
    public static let m: CGFloat = 8
    public static let ml: CGFloat = 10
    public static let l: CGFloat = 12
    public static let xl: CGFloat = 16
    public static let xxl: CGFloat = 20
    public static let xxxl: CGFloat = 24
    public static let huge: CGFloat = 32
  }

  public enum Radius {
    public static let hair: CGFloat = 2
    public static let control: CGFloat = 4
    public static let tile: CGFloat = 8
    public static let panel: CGFloat = 12
    public static let sheet: CGFloat = 16
    public static let hero: CGFloat = 20
    public static let chrome: CGFloat = 10
    public static let toolbar: CGFloat = 7
  }

  public enum FontSize {
    public static let badge: CGFloat = 9
    public static let tiny: CGFloat = 10
    public static let caption: CGFloat = 11
    public static let small: CGFloat = 12
    public static let body: CGFloat = 13
    public static let title: CGFloat = 15
    public static let large: CGFloat = 17
  }

  public enum LineHeight {
    public static let badge: CGFloat = 11
    public static let tiny: CGFloat = 13
    public static let caption: CGFloat = 14
    public static let small: CGFloat = 15
    public static let body: CGFloat = 16
    public static let title: CGFloat = 20
    public static let large: CGFloat = 22
    public static let display: CGFloat = 32
  }

  public enum Tracking {
    public static let tight: CGFloat = -0.4
    public static let caps: CGFloat = 0.4
    public static let wide: CGFloat = 1.2
  }

  public enum Display {
    public static let title = TypeToken(size: 22, tracking: 0, isMonospaced: false)
    public static let large = TypeToken(size: 26, tracking: -0.4, isMonospaced: false)
    public static let code = TypeToken(size: 26, tracking: 3, isMonospaced: true)
    public static let wordmark = TypeToken(size: 64, tracking: -1.5, isMonospaced: false)
  }

  public enum Weight {
    public static let regular: Font.Weight = .regular
    public static let medium: Font.Weight = .medium
    public static let semibold: Font.Weight = .semibold
    public static let bold: Font.Weight = .bold
  }

  public enum Hairline {
    public static let panel: CGFloat = 0.5
    public static let ring: CGFloat = 0.5
  }

  public enum Opacity {
    public static let disabled: Double = 0.45
  }

  public enum Duration {
    public static let fast: Double = 0.1
    public static let base: Double = 0.15
    public static let slow: Double = 0.25
    public static let long: Double = 0.4
    public static let sidebarPeekOut: Double = 0.15
  }

  public enum Spring {
    public static let snappy = SpringToken(response: 0.2, dampingFraction: 0.9)
    public static let smooth = SpringToken(response: 0.4, dampingFraction: 0.85)
    public static let bouncy = SpringToken(response: 0.3, dampingFraction: 0.6)
    public static let sidebarDock = SpringToken(response: 0.215, dampingFraction: 0.79)
    public static let sidebarPeek = SpringToken(response: 0.18, dampingFraction: 0.8)
  }

  public enum Shadow {
    public static let tooltip = ShadowToken(color: TokenColor(hex: 0x000000, opacity: 1), radius: 4, x: 0, y: 1, opacity: SchemeValue(dark: 0.15, light: 0.08))
    public static let popover = ShadowToken(color: TokenColor(hex: 0x000000, opacity: 1), radius: 18, x: 0, y: 8, opacity: SchemeValue(dark: 0.45, light: 0.16))
    public static let dialog = ShadowToken(color: TokenColor(hex: 0x000000, opacity: 1), radius: 24, x: 0, y: 10, opacity: SchemeValue(dark: 0.5, light: 0.18))
    public static let card = ShadowToken(color: TokenColor(hex: 0x000000, opacity: 1), radius: 16, x: 0, y: 6, opacity: SchemeValue(dark: 0.4, light: 0.144))
    public static let sheet = ShadowToken(color: TokenColor(hex: 0x000000, opacity: 1), radius: 20, x: 0, y: 8, opacity: SchemeValue(dark: 0.5, light: 0.18))
    public static let peek = ShadowToken(color: TokenColor(hex: 0x000000, opacity: 1), radius: 20, x: 0, y: 6, opacity: SchemeValue(dark: 0.5, light: 0.18))
  }

  public enum Role {
    public static let textPrimary = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 1), light: TokenColor(hex: 0x000000, opacity: 1))
    public static let textTab = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.7804), light: TokenColor(hex: 0x000000, opacity: 0.6784))
    public static let textSecondary = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.502), light: TokenColor(hex: 0x000000, opacity: 0.502))
    public static let textTertiary = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.349), light: TokenColor(hex: 0x000000, opacity: 0.349))
    public static let icon = SchemeColor(dark: TokenColor(hex: 0xF7F5FF, opacity: 0.7765), light: TokenColor(hex: 0x000000, opacity: 0.7765))
    public static let iconDisabled = SchemeColor(dark: TokenColor(hex: 0xF7F5FF, opacity: 0.302), light: TokenColor(hex: 0x000000, opacity: 0.302))
    public static let placeholder = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.5294), light: TokenColor(hex: 0x000000, opacity: 0.4))
    public static let divider = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.09), light: TokenColor(hex: 0x000000, opacity: 0.09))
    public static let card = SchemeColor(dark: TokenColor(hex: 0x121212, opacity: 0.5), light: TokenColor(hex: 0xFFFFFF, opacity: 0.7))
    public static let cardEdge = SchemeColor(dark: TokenColor(hex: 0x000000, opacity: 0.35), light: TokenColor(hex: 0x000000, opacity: 0.08))
    public static let panel = SchemeColor(dark: TokenColor(hex: 0x2A2A2A, opacity: 1), light: TokenColor(hex: 0xFFFFFF, opacity: 1))
    public static let panelBorder = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.1), light: TokenColor(hex: 0x000000, opacity: 0.1))
    public static let scrim = SchemeColor(dark: TokenColor(hex: 0x000000, opacity: 0.35), light: TokenColor(hex: 0x000000, opacity: 0.15))
    public static let toastFill = SchemeColor(dark: TokenColor(hex: 0x2C2A2B, opacity: 0.9), light: TokenColor(hex: 0xFFFFFF, opacity: 0.92))
    public static let tabHover = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.16), light: TokenColor(hex: 0xFFFFFF, opacity: 0.55))
    public static let tabPressed = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.31), light: TokenColor(hex: 0xFFFFFF, opacity: 0.7))
    public static let tabSelected = SchemeColor(dark: TokenColor(hex: 0x121212, opacity: 0.5), light: TokenColor(hex: 0xFFFFFF, opacity: 0.7))
    public static let tabSelectedText = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 1), light: TokenColor(hex: 0x000000, opacity: 1))
    public static let tabSelectedBorderTop = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.15), light: TokenColor(hex: 0xFFFFFF, opacity: 0.98))
    public static let tabSelectedBorderBottom = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.15), light: TokenColor(hex: 0x000000, opacity: 0.06))
    public static let tabSelectedShadow = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.15), light: TokenColor(hex: 0x000000, opacity: 0.12))
    public static let pinnedResting = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.1), light: TokenColor(hex: 0x000000, opacity: 0.05))
    public static let pinnedRestingStroke = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.14), light: TokenColor(hex: 0x000000, opacity: 0.2))
    public static let pinnedSelectedFill = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.25), light: TokenColor(hex: 0xFFFFFF, opacity: 0.7))
    public static let pinnedSelectedRim = SchemeColor(dark: TokenColor(hex: 0x000000, opacity: 0.85), light: TokenColor(hex: 0x000000, opacity: 0.12))
    public static let pinnedSelectedOutline = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.2), light: TokenColor(hex: 0xFFFFFF, opacity: 0.98))
    public static let field = SchemeColor(dark: TokenColor(hex: 0x000000, opacity: 0.25), light: TokenColor(hex: 0xFFFFFF, opacity: 1))
    public static let fieldBorder = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.12), light: TokenColor(hex: 0x000000, opacity: 0.14))
    public static let control = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.1), light: TokenColor(hex: 0xFFFFFF, opacity: 1))
    public static let controlHover = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.14), light: TokenColor(hex: 0xF7F7F7, opacity: 1))
    public static let controlPressed = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.2), light: TokenColor(hex: 0xEBEBEB, opacity: 1))
    public static let controlBorder = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.08), light: TokenColor(hex: 0x000000, opacity: 0.14))
    public static let accent = SchemeColor(dark: TokenColor(hex: 0x4A77D4, opacity: 1), light: TokenColor(hex: 0x6395FC, opacity: 1))
    public static let formAccent = SchemeColor(dark: TokenColor(hex: 0x0A84FF, opacity: 1), light: TokenColor(hex: 0x007AFF, opacity: 1))
    public static let destructive = SchemeColor(dark: TokenColor(hex: 0xFF453A, opacity: 1), light: TokenColor(hex: 0xFF3B30, opacity: 1))
    public static let warning = SchemeColor(dark: TokenColor(hex: 0xFF9F0A, opacity: 1), light: TokenColor(hex: 0xFF9500, opacity: 1))
    public static let success = SchemeColor(dark: TokenColor(hex: 0x30D158, opacity: 1), light: TokenColor(hex: 0x34C759, opacity: 1))
    public static let arcSelectedFill = SchemeColor(dark: TokenColor(hex: 0xFFFFFF, opacity: 0.24), light: TokenColor(hex: 0xFFFFFF, opacity: 0.8))
  }

  public enum RoleValue {
    public static let grain = SchemeValue(dark: 0.006, light: 0.05)
    public static let panelShadowOpacity = SchemeValue(dark: 0.5, light: 0.18)
    public static let tabSelectedShadowRadius = SchemeValue(dark: 15, light: 12.5)
  }
}
