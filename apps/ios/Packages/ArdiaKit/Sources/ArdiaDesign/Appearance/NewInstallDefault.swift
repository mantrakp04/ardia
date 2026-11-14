import Foundation

public struct NewInstallDefault: Sendable {
  public let setting: String
  public let marker: String
  public let evidence: [String]

  public init(setting: String, marker: String, evidence: [String]) {
    self.setting = setting
    self.marker = marker
    self.evidence = evidence
  }

  public func settle(in defaults: UserDefaults) {
    guard defaults.object(forKey: marker) == nil else { return }
    defaults.set(true, forKey: marker)
    guard defaults.object(forKey: setting) == nil, evidence.contains(where: { defaults.object(forKey: $0) != nil }) else { return }
    defaults.set(false, forKey: setting)
  }
}
