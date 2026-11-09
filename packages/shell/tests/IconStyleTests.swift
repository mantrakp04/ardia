import XCTest
@testable import ArdiaUpdaterCore

final class IconStyleTests: XCTestCase {
  func testTintedAndClearShowTheDefaultIconAndOtherStylesKeepThePick() {
    let cases: [(String, String?, String)] = [
      ("mono", nil, "mono"),
      ("mono", "RegularLight", "mono"),
      ("mono", "RegularDark", "mono"),
      ("mono", "RegularAutomatic", "mono"),
      ("mono", "FutureStyle", "mono"),
      ("mono", "TintedLight", "default"),
      ("mono", "TintedDark", "default"),
      ("mono", "TintedAutomatic", "default"),
      ("midnight", "ClearLight", "default"),
      ("midnight", "ClearDark", "default"),
      ("midnight", "ClearAutomatic", "default"),
      ("default", "TintedLight", "default"),
      ("default", nil, "default"),
    ]
    for (saved, theme, shown) in cases {
      XCTAssertEqual(IconStyle.shown(saved: saved, theme: theme), shown, "\(saved) under \(theme ?? "no style")")
    }
  }

  func testTheWatcherHearsAStyleChangeMadeByAnotherProcess() throws {
    let suite = "com.ardia.icon-style-test-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let changed = expectation(description: "the watcher calls back")
    changed.assertForOverFulfill = false
    var seen: [String?] = []
    let watcher = IconStyleWatcher(defaults) {
      seen.append(defaults.string(forKey: IconStyle.defaultsKey))
      if seen.last == "TintedDark" { changed.fulfill() }
    }
    let write = Process()
    write.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
    write.arguments = ["write", suite, IconStyle.defaultsKey, "TintedDark"]
    try write.run()
    write.waitUntilExit()
    wait(for: [changed], timeout: 5)
    XCTAssertEqual(seen.last, "TintedDark")
    withExtendedLifetime(watcher) {}
  }
}
