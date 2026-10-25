import Foundation
import Observation

#if canImport(UIKit)
  import UIKit
#endif

@MainActor
@Observable
public final class IntelligenceAvailability {
  public private(set) var status: IntelligenceStatus

  private let model: any IntelligenceModel
  @ObservationIgnored private var watchers: [Task<Void, Never>] = []

  public init(model: any IntelligenceModel) {
    self.model = model
    status = model.status
  }

  isolated deinit {
    watchers.forEach { $0.cancel() }
  }

  public var isAvailable: Bool { status.isAvailable }

  public func refresh() {
    let current = model.status
    if current != status { status = current }
  }

  public func stopWatching() {
    watchers.forEach { $0.cancel() }
    watchers = []
  }

  public func startWatching() {
    guard watchers.isEmpty else { return }
    let changes = model.statusChanges()
    watchers.append(
      Task { [weak self] in
        for await _ in changes {
          self?.refresh()
        }
      })
    #if canImport(UIKit)
      watchers.append(
        Task { [weak self] in
          for await _ in NotificationCenter.default.notifications(named: UIApplication.didBecomeActiveNotification) {
            self?.refresh()
          }
        })
    #endif
  }
}
