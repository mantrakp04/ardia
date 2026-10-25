import UIKit
import WebKit

@MainActor
final class PageCoverCache {
  static let limit = 8

  private var images: [UUID: UIImage] = [:]
  private var order: [UUID] = []

  func image(for id: UUID) -> UIImage? {
    images[id]
  }

  func store(_ image: UIImage, for id: UUID) {
    images[id] = image
    order.removeAll { $0 == id }
    order.append(id)
    while order.count > Self.limit { images[order.removeFirst()] = nil }
  }

  func forget(_ id: UUID) {
    images[id] = nil
    order.removeAll { $0 == id }
  }

  static func capture(_ webView: WKWebView, croppingTop: CGFloat = 0) -> UIImage? {
    guard webView.window != nil, !webView.bounds.isEmpty, !webView.isHidden else { return nil }
    let refresh = webView.scrollView.refreshControl
    let wasHidden = refresh?.isHidden ?? true
    refresh?.isHidden = true
    defer { refresh?.isHidden = wasHidden }
    let format = UIGraphicsImageRendererFormat.preferred()
    format.opaque = true
    let bounds = webView.bounds
    let area = CGRect(x: 0, y: croppingTop, width: bounds.width, height: bounds.height - croppingTop)
    return UIGraphicsImageRenderer(bounds: area, format: format).image { _ in
      _ = webView.drawHierarchy(in: bounds, afterScreenUpdates: false)
    }
  }
}
