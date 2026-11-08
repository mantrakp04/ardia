import XCTest
@testable import ArdiaUpdaterCore

final class GlyphInkTests: XCTestCase {
  private func alpha(width: Int, height: Int, ink: ClosedRange<Int>, rows: ClosedRange<Int>, level: UInt8 = 255) -> [UInt8] {
    var pixels = [UInt8](repeating: 0, count: width * height)
    for y in rows { for x in ink { pixels[y * width + x] = level } }
    return pixels
  }

  func testAGlyphAlreadyOnTheCentreNeedsNoShift() throws {
    let pixels = alpha(width: 16, height: 16, ink: 4...11, rows: 4...11)
    let shift = try XCTUnwrap(GlyphInk.offset(alpha: pixels, width: 16, height: 16, scale: 8))
    XCTAssertEqual(shift.dx, 0, accuracy: 1e-9)
    XCTAssertEqual(shift.dy, 0, accuracy: 1e-9)
  }

  func testAGlyphLeftAndAboveTheCentreIsPushedRightAndDownInPoints() throws {
    let pixels = alpha(width: 16, height: 16, ink: 2...9, rows: 3...10)
    let shift = try XCTUnwrap(GlyphInk.offset(alpha: pixels, width: 16, height: 16, scale: 8))
    XCTAssertEqual(shift.dx, 2.0 / 8, accuracy: 1e-9)
    XCTAssertEqual(shift.dy, 1.0 / 8, accuracy: 1e-9)
  }

  func testAGlyphRightAndBelowTheCentreIsPushedLeftAndUp() throws {
    let pixels = alpha(width: 16, height: 16, ink: 7...14, rows: 9...14)
    let shift = try XCTUnwrap(GlyphInk.offset(alpha: pixels, width: 16, height: 16, scale: 4))
    XCTAssertEqual(shift.dx, -3.0 / 4, accuracy: 1e-9)
    XCTAssertEqual(shift.dy, -1, accuracy: 1e-9)
  }

  func testFaintFringePixelsDoNotCountAsInk() throws {
    var pixels = alpha(width: 16, height: 16, ink: 4...11, rows: 4...11)
    pixels[0] = GlyphInk.inkThreshold - 1
    pixels[15 * 16 + 15] = 1
    let shift = try XCTUnwrap(GlyphInk.offset(alpha: pixels, width: 16, height: 16, scale: 8))
    XCTAssertEqual(shift.dx, 0, accuracy: 1e-9)
    XCTAssertEqual(shift.dy, 0, accuracy: 1e-9)
  }

  func testPixelsAtTheThresholdCountAsInk() throws {
    let pixels = alpha(width: 16, height: 16, ink: 0...7, rows: 0...7, level: GlyphInk.inkThreshold)
    let shift = try XCTUnwrap(GlyphInk.offset(alpha: pixels, width: 16, height: 16, scale: 1))
    XCTAssertEqual(shift.dx, 4, accuracy: 1e-9)
    XCTAssertEqual(shift.dy, 4, accuracy: 1e-9)
  }

  func testNothingDrawnOrBadInputIsNotAMeasurement() {
    let blank = [UInt8](repeating: 0, count: 64)
    XCTAssertNil(GlyphInk.offset(alpha: blank, width: 8, height: 8, scale: 8))
    let full = [UInt8](repeating: 255, count: 10)
    XCTAssertNil(GlyphInk.offset(alpha: full, width: 8, height: 8, scale: 8))
    XCTAssertNil(GlyphInk.offset(alpha: full, width: 0, height: 0, scale: 8))
    XCTAssertNil(GlyphInk.offset(alpha: blank, width: 8, height: 8, scale: 0))
  }
}
