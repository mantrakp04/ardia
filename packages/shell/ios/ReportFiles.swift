import Foundation
import zlib

enum ReportFiles {
  enum Failure: Error { case open, deflate, write }

  private static let chunk = 1 << 20

  static func draftDirectory() -> String {
    let base = (try? DocumentStore.url("Report Drafts"))
      ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ArdiaReport", isDirectory: true)
    let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.path
  }

  static func size(_ path: String) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? -1
  }

  static func remove(_ path: String) {
    try? FileManager.default.removeItem(atPath: path)
  }

  static func gzip(file source: String, to destination: String) throws -> Int {
    guard let input = InputStream(fileAtPath: source) else { throw Failure.open }
    input.open()
    defer { input.close() }
    return try gzip(to: destination) { buffer in
      let read = input.read(buffer, maxLength: chunk)
      return read < 0 ? 0 : read
    }
  }

  static func gzip(text: String, to destination: String) throws -> Int {
    let data = Data(text.utf8)
    var offset = 0
    return try gzip(to: destination) { buffer in
      let count = min(chunk, data.count - offset)
      guard count > 0 else { return 0 }
      data.copyBytes(to: buffer, from: offset..<(offset + count))
      offset += count
      return count
    }
  }

  private static func gzip(to destination: String, read: (UnsafeMutablePointer<UInt8>) -> Int) throws -> Int {
    FileManager.default.createFile(atPath: destination, contents: nil)
    guard let output = FileHandle(forWritingAtPath: destination) else { throw Failure.write }
    defer { try? output.close() }
    var stream = z_stream()
    guard deflateInit2_(&stream, 6, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK
    else { throw Failure.deflate }
    defer { deflateEnd(&stream) }
    let inBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
    let outBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
    defer {
      inBuffer.deallocate()
      outBuffer.deallocate()
    }
    var written = 0
    var flush = Z_NO_FLUSH
    repeat {
      let count = read(inBuffer)
      flush = count == 0 ? Z_FINISH : Z_NO_FLUSH
      stream.next_in = inBuffer
      stream.avail_in = uInt(count)
      repeat {
        stream.next_out = outBuffer
        stream.avail_out = uInt(chunk)
        let status = deflate(&stream, flush)
        if status == Z_STREAM_ERROR { throw Failure.deflate }
        let produced = chunk - Int(stream.avail_out)
        if produced > 0 {
          output.write(Data(bytesNoCopy: outBuffer, count: produced, deallocator: .none))
          written += produced
        }
      } while stream.avail_out == 0
    } while flush != Z_FINISH
    return written
  }
}
