import CoreGraphics
import Foundation
import Testing
@testable import ArdiaBrowser

@MainActor
struct TabSnapshotStoreTests {
  func solidImage(gray: CGFloat) -> CGImage {
    let context = CGContext(data: nil, width: 40, height: 80, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    context.setFillColor(gray: gray, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: 40, height: 80))
    return context.makeImage()!
  }

  @Test func firstAndLaterSavesBothReachDisk() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: "snapshots-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let id = UUID()
    let first = TabSnapshotStore(directory: directory)
    let name = try #require(await first.save(solidImage(gray: 0.2), scale: 1, for: id))
    #expect(FileManager.default.fileExists(atPath: directory.appending(path: name).path))
    #expect(try #require(await first.save(solidImage(gray: 0.8), scale: 1, for: id)) == name)

    let relaunched = TabSnapshotStore(directory: directory)
    #expect(await relaunched.image(named: name) != nil)
    let leftovers = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasPrefix(".") }
    #expect(leftovers.isEmpty)
  }

  @Test func aTabDeletedDuringItsFirstSaveLeavesNoImage() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: "snapshots-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let id = UUID()
    let store = TabSnapshotStore(directory: directory)
    let saving = Task { await store.save(solidImage(gray: 0.4), scale: 1, for: id) }
    store.removeTabs([id])
    #expect(await saving.value == nil)
    #expect(await store.save(solidImage(gray: 0.6), scale: 1, for: id) == nil)
    let images = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    #expect(images.isEmpty)
  }
}
