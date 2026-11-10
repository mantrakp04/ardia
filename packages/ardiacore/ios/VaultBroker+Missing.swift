import Foundation

extension VaultBroker {
  static let missingRefetchInterval: TimeInterval = 30
  static let missingRefetchKey = "missingRefetchAt"

  func refetchAfterMissing(_ provider: any VaultProvider) {
    let id = provider.id
    guard sessions.session(id) != nil, loading[id] == nil else { return }
    let now = Date().timeIntervalSince1970
    let last = sessions.value(id, Self.missingRefetchKey).flatMap(Double.init) ?? 0
    guard now - last >= Self.missingRefetchInterval else { return }
    sessions.setValue(id, Self.missingRefetchKey, String(now))
    sessions.setValue(id, "syncedAt", nil)
    NSLog("[vaults] %@ no longer has an item Ardia listed; refetching its list", id)
    Task { _ = await self.fetchItems(provider) }
  }
}
