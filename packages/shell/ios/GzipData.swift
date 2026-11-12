import Foundation

enum GzipData {
  private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
    var c = UInt32(n)
    for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  static func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    data.withUnsafeBytes { raw in
      for byte in raw.bindMemory(to: UInt8.self) { crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8) }
    }
    return crc ^ 0xFFFF_FFFF
  }

  private static func littleEndian(_ value: UInt32) -> [UInt8] {
    [UInt8(value & 0xFF), UInt8((value >> 8) & 0xFF), UInt8((value >> 16) & 0xFF), UInt8((value >> 24) & 0xFF)]
  }

  static func compress(_ data: Data) -> Data? {
    let deflated: Data
    if data.isEmpty {
      deflated = Data([0x03, 0x00])
    } else {
      guard let raw = try? (data as NSData).compressed(using: .zlib) as Data else { return nil }
      deflated = raw
    }
    var out = Data([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03])
    out.append(deflated)
    out.append(contentsOf: littleEndian(crc32(data)))
    out.append(contentsOf: littleEndian(UInt32(truncatingIfNeeded: data.count)))
    return out
  }
}
