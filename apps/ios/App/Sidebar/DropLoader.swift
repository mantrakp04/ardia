import ArdiaDesign
import Foundation
import OSLog

@MainActor
enum DropLoader {
  private static let log = Logger(subsystem: "com.ardia.browser.ios", category: "sidebar")

  static func load(_ providers: [NSItemProvider], deliver: @escaping @MainActor @Sendable (SidebarDrop.Destination) -> Void) -> Bool {
    guard let provider = providers.first, SidebarDrop.accepts(typeIdentifiers: providers.flatMap(\.registeredTypeIdentifiers)) else { return false }
    if provider.canLoadObject(ofClass: URL.self) {
      _ = provider.loadObject(ofClass: URL.self) { url, error in
        let destination = url.flatMap { SidebarDrop.destination(for: $0) }
        Task { @MainActor in finish(destination, error: error, deliver: deliver) }
      }
      return true
    }
    if provider.canLoadObject(ofClass: String.self) {
      _ = provider.loadObject(ofClass: String.self) { text, error in
        let destination = text.flatMap { SidebarDrop.destination(for: $0) }
        Task { @MainActor in finish(destination, error: error, deliver: deliver) }
      }
      return true
    }
    return false
  }

  private static func finish(_ destination: SidebarDrop.Destination?, error: (any Error)?, deliver: @MainActor (SidebarDrop.Destination) -> Void) {
    if let error {
      log.error("drop failed: \(error.localizedDescription, privacy: .public)")
      return
    }
    guard let destination else {
      log.notice("drop ignored: nothing to open")
      return
    }
    deliver(destination)
  }
}
