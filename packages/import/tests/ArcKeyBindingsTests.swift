import XCTest
@testable import ArdiaImportCore

final class ArcKeyBindingsTests: XCTestCase {
  func testReadsUserOverridesWithTheirModifiers() {
    let json = """
    {"version":1,"userOverrides":[
      {"action":{"identifier":"showSidebar","name":"Show/Hide Sidebar"},
       "state":{"valid":{"_0":{"keyEquivalent":"\\\\","deviceIndependentModifierFlags":1048576}}},"source":"userDefined"},
      {"action":{"identifier":"newTab"},"state":{"valid":{"_0":{"keyEquivalent":"t","deviceIndependentModifierFlags":1179648}}}},
      {"action":{"identifier":"cleared"},"state":{"invalid":{}}}
    ]}
    """
    let shortcuts = ArcKeyBindings.parse(Data(json.utf8))
    XCTAssertEqual(shortcuts, [
      ImportedShortcut(action: "showSidebar", key: "\\", modifiers: ["command"]),
      ImportedShortcut(action: "newTab", key: "t", modifiers: ["shift", "command"]),
    ])
  }

  func testAMalformedEntryIsSkippedAndTheRestStillCome() {
    let json = """
    {"userOverrides":[
      null,
      "junk",
      {"action":{"identifier":"newTab"},"state":{"valid":{"_0":{"keyEquivalent":"t","deviceIndependentModifierFlags":1048576}}}}
    ]}
    """
    XCTAssertEqual(ArcKeyBindings.parse(Data(json.utf8)), [ImportedShortcut(action: "newTab", key: "t", modifiers: ["command"])])
  }

  func testMalformedDataGivesNothing() {
    XCTAssertEqual(ArcKeyBindings.parse(Data("[]".utf8)), [])
    XCTAssertEqual(ArcKeyBindings.parse(Data("{".utf8)), [])
  }
}
