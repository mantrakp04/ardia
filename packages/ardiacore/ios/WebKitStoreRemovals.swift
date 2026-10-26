import Foundation
import WebKit

enum WebKitStoreRemovals {
  private static let webKitStarted: Void = { _ = WKWebsiteDataStore.nonPersistent() }()

  static func exists(_ identifier: UUID, done: @escaping (Bool) -> Void) {
    webKitStarted
    WKWebsiteDataStore.fetchAllDataStoreIdentifiers { stores in
      DispatchQueue.main.async { done(stores.contains(identifier)) }
    }
  }

  static func remove(_ identifier: UUID, tries: Int, done: @escaping (Bool) -> Void) {
    webKitStarted
    WKWebsiteDataStore.remove(forIdentifier: identifier) { error in
      DispatchQueue.main.async {
        if error == nil { return done(true) }
        guard tries > 1 else {
          NSLog("[webkit] the data store %@ is still in use: %@", identifier.uuidString, error.map { "\($0)" } ?? "")
          return done(false)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { remove(identifier, tries: tries - 1, done: done) }
      }
    }
  }
}
