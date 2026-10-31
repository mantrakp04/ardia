import AppKit
import XCTest
@testable import ArdiaMenuCore

final class MenuFaviconTests: XCTestCase {
  let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII="
  var uri: String { "data:image/png;base64,\(png)" }

  func testUnsupportedSourcesDoNotSpendTheBudgetBeforeAValidImage() {
    let sources = Array(repeating: "", count: 20) + ["https://example.com/icon.png", "http://localhost/icon.png", uri]
    let images = MenuFavicon.prepare(sources)
    XCTAssertEqual(images.count, 1)
    let entry = NSMenuItem()
    MenuFavicon.apply(to: entry, favicon: uri, symbol: "globe", images: images)
    XCTAssertEqual(entry.image?.size, NSSize(width: 16, height: 16))
    XCTAssertFalse(entry.image!.isTemplate)
    MenuFavicon.apply(to: entry, favicon: "", symbol: "globe", images: images)
    XCTAssertTrue(entry.image!.isTemplate)
  }

  func testDuplicateFailuresDoNotSpendTheBudgetButDistinctFailuresDo() {
    let invalid = "data:image/png;base64,broken"
    let images = MenuFavicon.prepare(Array(repeating: invalid, count: 16) + [uri])
    XCTAssertNotNil(images[uri])
    let distinct = (0..<16).map { "data:image/png;name=\($0);base64,broken" }
    XCTAssertNil(MenuFavicon.prepare(distinct + [uri])[uri])
  }

  func testPreparedImagesShareTheLimitAndKeepFallbackImages() {
    let sources = (0..<20).map { "data:image/png;name=\($0);base64,\(png)" }
    let images = MenuFavicon.prepare(sources)
    XCTAssertEqual(images.count, 16)
    let menu = NSMenu()
    for group in 0..<2 {
      let parent = NSMenuItem()
      parent.submenu = NSMenu()
      menu.addItem(parent)
      for source in sources[(group * 10)..<(group * 10 + 10)] {
        let entry = NSMenuItem()
        MenuFavicon.apply(to: entry, favicon: source, symbol: "globe", images: images)
        parent.submenu!.addItem(entry)
      }
    }
    let icons = menu.items.flatMap { $0.submenu!.items }.compactMap(\.image)
    XCTAssertTrue(icons.prefix(16).allSatisfy { !$0.isTemplate && $0.size == NSSize(width: 16, height: 16) })
    XCTAssertTrue(icons.suffix(4).allSatisfy(\.isTemplate))
  }

  func testFileImageAndInvalidLocalImageAssignment() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("menu-favicon-\(UUID()).png")
    defer { try? FileManager.default.removeItem(at: file) }
    try Data(base64Encoded: png)!.write(to: file)
    let invalid = "data:image/png;base64,broken"
    let images = MenuFavicon.prepare([file.absoluteString, invalid])
    let entry = NSMenuItem()
    MenuFavicon.apply(to: entry, favicon: file.absoluteString, symbol: "globe", images: images)
    XCTAssertEqual(entry.image?.size, NSSize(width: 16, height: 16))
    XCTAssertFalse(entry.image!.isTemplate)
    MenuFavicon.apply(to: entry, favicon: invalid, symbol: "globe", images: images)
    XCTAssertTrue(entry.image!.isTemplate)
    try Data(repeating: 0, count: MenuFavicon.maxBytes + 1).write(to: file)
    XCTAssertTrue(MenuFavicon.prepare([file.absoluteString]).isEmpty)
  }

  func testOversizedDataAndDimensionsFallBackAndThumbnailsAreBounded() throws {
    let oversized = "data:image/png;base64," + Data(repeating: 0, count: MenuFavicon.maxBytes + 1).base64EncodedString()
    XCTAssertTrue(MenuFavicon.prepare([oversized]).isEmpty)
    for width in [256, 1025] {
      let bitmap = try XCTUnwrap(NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: width,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
      ))
      let data = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
      let source = "data:image/png;base64,\(data.base64EncodedString())"
      let image = MenuFavicon.prepare([source])[source]
      if width == 256 {
        XCTAssertEqual(image?.width, 32)
        XCTAssertEqual(image?.height, 32)
      } else {
        XCTAssertNil(image)
      }
    }
  }
}
