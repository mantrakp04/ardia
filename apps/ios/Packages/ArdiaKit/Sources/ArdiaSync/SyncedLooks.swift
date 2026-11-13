import Foundation

public struct SyncedTheme: Codable, Equatable, Hashable, Sendable {
  public enum Mode: String, Codable, Sendable {
    case auto
    case light
    case dark

    public init(from decoder: any Decoder) throws {
      self = Mode(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .auto
    }
  }

  public enum Texture: String, Codable, CaseIterable, Sendable {
    case grain
    case sand
    case denim
    case tweed

    public init(from decoder: any Decoder) throws {
      self = Texture(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .grain
    }
  }

  public struct Stop: Codable, Equatable, Hashable, Sendable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double
    public var x: Double
    public var y: Double

    private enum CodingKeys: String, CodingKey {
      case red = "r"
      case green = "g"
      case blue = "b"
      case alpha = "a"
      case x
      case y
    }

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1, x: Double = 0.5, y: Double = 0.5) {
      self.red = red
      self.green = green
      self.blue = blue
      self.alpha = alpha
      self.x = x
      self.y = y
    }
  }

  public struct Look: Codable, Equatable, Hashable, Sendable {
    public static let defaultAngle: Double = 135

    public var stops: [Stop]
    public var intensity: Double
    public var grain: Double
    public var texture: Texture
    public var translucency: Double
    public var angle: Double

    public init(stops: [Stop], intensity: Double = 0.6, grain: Double = 0, texture: Texture = .grain, translucency: Double = 1, angle: Double = Look.defaultAngle) {
      self.stops = stops
      self.intensity = intensity
      self.grain = grain
      self.texture = texture
      self.translucency = translucency
      self.angle = angle
    }
  }

  public var colors: [String]
  public var darkColors: [String]?
  public var mode: Mode?
  public var light: Look?
  public var dark: Look?

  public init(colors: [String], darkColors: [String]?, mode: Mode? = nil, light: Look? = nil, dark: Look? = nil) {
    self.colors = colors
    self.darkColors = darkColors
    self.mode = mode
    self.light = light
    self.dark = dark
  }
}

public struct SyncedLookSettings: Codable, Equatable, Hashable, Sendable {
  public enum Appearance: String, Codable, Sendable {
    case auto
    case light
    case dark
  }

  public enum InterfaceStyle: String, Codable, Sendable {
    case glass
    case classic
  }

  public enum TabGlow: String, Codable, Sendable {
    case full
    case soft
    case off
  }

  public enum SidebarSide: String, Codable, Sendable {
    case left
    case right
  }

  public var appearance: Appearance?
  public var interfaceStyle: InterfaceStyle?
  public var glassTintWithTheme: Bool?
  public var glassTintAmount: Double?
  public var selectedTabGlow: TabGlow?
  public var pageFrame: Int?
  public var sidebarSide: SidebarSide?
  public var profileSwitcherIcons: Bool?

  public init(
    appearance: Appearance? = nil,
    interfaceStyle: InterfaceStyle? = nil,
    glassTintWithTheme: Bool? = nil,
    glassTintAmount: Double? = nil,
    selectedTabGlow: TabGlow? = nil,
    pageFrame: Int? = nil,
    sidebarSide: SidebarSide? = nil,
    profileSwitcherIcons: Bool? = nil
  ) {
    self.appearance = appearance
    self.interfaceStyle = interfaceStyle
    self.glassTintWithTheme = glassTintWithTheme
    self.glassTintAmount = glassTintAmount
    self.selectedTabGlow = selectedTabGlow
    self.pageFrame = pageFrame
    self.sidebarSide = sidebarSide
    self.profileSwitcherIcons = profileSwitcherIcons
  }

  private enum CodingKeys: String, CodingKey {
    case appearance, interfaceStyle, glassTintWithTheme, glassTintAmount, selectedTabGlow, pageFrame, sidebarSide, profileSwitcherIcons
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    func value<T: Decodable>(_ key: CodingKeys) -> T? { (try? container.decodeIfPresent(T.self, forKey: key)) ?? nil }
    func choice<T: RawRepresentable>(_ key: CodingKeys) -> T? where T.RawValue == String { value(key).flatMap(T.init(rawValue:)) }
    appearance = choice(.appearance)
    interfaceStyle = choice(.interfaceStyle)
    glassTintWithTheme = value(.glassTintWithTheme)
    glassTintAmount = value(.glassTintAmount)
    selectedTabGlow = choice(.selectedTabGlow)
    pageFrame = value(.pageFrame)
    sidebarSide = choice(.sidebarSide)
    profileSwitcherIcons = value(.profileSwitcherIcons)
  }
}
