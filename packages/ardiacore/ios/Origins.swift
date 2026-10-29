import Foundation
import WebKit

enum Origins {
  private static let defaultPorts = ["http": 80, "https": 443]

  static func of(_ url: URL) -> String? {
    guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else { return nil }
    let port = url.port.flatMap { $0 == defaultPorts[scheme] ? nil : $0 }
    return "\(scheme)://\(host)" + (port.map { ":\($0)" } ?? "")
  }

  static func of(_ origin: WKSecurityOrigin) -> String {
    "\(origin.protocol.lowercased())://\(origin.host.lowercased())" + (origin.port > 0 ? ":\(origin.port)" : "")
  }
}
