import ArdiaBrowser
import Foundation
import OSLog
import SwiftData

extension AppModel {
  struct OpenedStore {
    let container: ModelContainer
    let isFallback: Bool
  }

  static let storeLog = Logger(subsystem: "com.ardia.browser.ios", category: "store")

  static func openBrowserStore(isDemo: Bool) -> OpenedStore {
    do {
      return OpenedStore(container: try BrowserStore.makeContainer(isDemo ? .inMemory : .appGroup), isFallback: false)
    } catch {
      storeLog.fault("The browser store didn't open, so this launch keeps tabs in memory and doesn't sync them: \(String(describing: error), privacy: .public)")
      do {
        return OpenedStore(container: try BrowserStore.makeContainer(.inMemory), isFallback: true)
      } catch {
        fatalError("Even an in-memory browser store didn't open: \(error)")
      }
    }
  }

  func warnIfStoreIsFallback() {
    guard usesFallbackStore else { return }
    toasts.show(Toast(String(localized: "Couldn’t Open Your Tabs. Restart Ardia."), symbol: "exclamationmark.triangle.fill", duration: .seconds(8)))
  }
}
