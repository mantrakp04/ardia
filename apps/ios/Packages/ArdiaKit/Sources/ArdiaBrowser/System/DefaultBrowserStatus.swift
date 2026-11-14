#if canImport(UIKit)
import Foundation
import Observation
import OSLog
import UIKit

@MainActor
@Observable
public final class DefaultBrowserStatus {
  private enum Key {
    static let isDefault = "defaultBrowser.isDefault"
    static let askedAt = "defaultBrowser.askedAt"
    static let isAwaitingSettingsReturn = "defaultBrowser.isAwaitingSettingsReturn"
  }

  public static let isOffered = Bundle.main.object(forInfoDictionaryKey: "ArdiaDefaultBrowser") as? String == "YES"
  static let askInterval: TimeInterval = 100 * 24 * 60 * 60
  private static let log = Logger(subsystem: "com.ardia.browser.ios", category: "default-browser")

  public private(set) var isDefault: Bool

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let asksSystem: Bool

  public init(defaults: UserDefaults, asksSystem: Bool) {
    self.defaults = defaults
    self.asksSystem = asksSystem && Self.isOffered
    isDefault = Self.isOffered && defaults.bool(forKey: Key.isDefault)
  }

  public func willOpenSystemSettings() {
    defaults.set(true, forKey: Key.isAwaitingSettingsReturn)
  }

  public func receivedLinkFromSystem() {
    guard Self.isOffered else { return }
    record(true)
  }

  public func sceneBecameActive() {
    guard asksSystem, defaults.bool(forKey: Key.isAwaitingSettingsReturn) || isDueToAsk else { return }
    defaults.removeObject(forKey: Key.isAwaitingSettingsReturn)
    defaults.set(Date.now, forKey: Key.askedAt)
    do {
      let answer = try UIApplication.shared.isDefault(.webBrowser)
      Self.log.notice("the system says default browser: \(answer, privacy: .public)")
      record(answer)
    } catch {
      Self.log.notice("the system gave no default browser answer: \(String(describing: error), privacy: .public)")
    }
  }

  private var isDueToAsk: Bool {
    guard let askedAt = defaults.object(forKey: Key.askedAt) as? Date else { return true }
    return Date.now.timeIntervalSince(askedAt) > Self.askInterval
  }

  private func record(_ answer: Bool) {
    isDefault = answer
    defaults.set(answer, forKey: Key.isDefault)
  }
}
#endif
