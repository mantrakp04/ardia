import Foundation

public struct ThisDevice: Equatable, Sendable {
  public let kind: SyncedDevice.Kind

  public init(kind: SyncedDevice.Kind) {
    self.kind = kind
  }

  public static let current = ThisDevice(
    kind: kind(simulatorModel: ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], hardwareModel: hardwareModel)
  )

  public static func kind(model: String) -> SyncedDevice.Kind {
    model.hasPrefix("iPad") ? .tablet : .phone
  }

  public static func kind(simulatorModel: String?, hardwareModel: String) -> SyncedDevice.Kind {
    guard let simulatorModel, !simulatorModel.isEmpty else { return kind(model: hardwareModel) }
    return kind(model: simulatorModel)
  }

  public var isTablet: Bool { kind == .tablet }

  public var noun: String { isTablet ? "iPad" : "iPhone" }

  public var defaultName: String { noun }

  public func isOtherKindsDefault(_ name: String) -> Bool {
    name == (isTablet ? ThisDevice(kind: .phone) : ThisDevice(kind: .tablet)).defaultName
  }

  public var title: String { String(localized: "This \(noun)") }

  public var symbol: String { isTablet ? "ipad" : "iphone" }

  public var pairSymbol: String { isTablet ? "macbook.and.ipad" : "macbook.and.iphone" }

  public var offlineMessage: String { String(localized: "Your \(noun) isn’t connected to the internet.") }

  private static var hardwareModel: String {
    var size = 0
    guard sysctlbyname("hw.machine", nil, &size, nil, 0) == 0, size > 0 else { return "" }
    var buffer = [UInt8](repeating: 0, count: size)
    guard sysctlbyname("hw.machine", &buffer, &size, nil, 0) == 0 else { return "" }
    return String(decoding: buffer.prefix { $0 != 0 }, as: UTF8.self)
  }
}
