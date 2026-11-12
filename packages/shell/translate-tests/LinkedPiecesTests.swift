import XCTest
@testable import ArdiaTranslateCore

final class LinkedPiecesTests: XCTestCase {
  private func answer(_ runs: [(String, Int?)]) -> AttributedString {
    var text = AttributedString()
    for (words, piece) in runs {
      var run = AttributedString(words)
      if let piece { run.link = URL(string: "ac-piece:\(piece)") }
      text += run
    }
    return text
  }

  func testEachPieceGetsItsOwnTaggedPart() {
    let parts = LinkedPieces.parts(of: answer([("Lisez les ", 0), ("notes", 1), (" pour plus.", 2)]), over: ["Read the ", "notes", " for more."])
    XCTAssertEqual(parts, ["Lisez les ", "notes", " pour plus."])
  }

  func testAMissingPieceFailsInsteadOfBlankingItsNode() {
    XCTAssertNil(LinkedPieces.parts(of: answer([("bonjour le monde", 0)]), over: ["hello ", "world"]))
  }

  func testAPieceOutOfRangeFails() {
    XCTAssertNil(LinkedPieces.parts(of: answer([("bonjour ", 0), ("monde", 5)]), over: ["hello ", "world"]))
  }

  func testAPieceTaggedTwiceGetsExactlyItsOwnRunsInReadingOrder() {
    let parts = LinkedPieces.parts(of: answer([("Klicken ", 0), ("hier", 1), (" zum Fortfahren", 2), (" Sie.", 0)]), over: ["Click ", "here", " to continue."])
    XCTAssertEqual(parts, ["Klicken  Sie.", "hier", " zum Fortfahren"])
  }

  func testAGermanAnswerThatSplitsAPieceKeepsEachRunInItsOwnNode() {
    let answer = answer([("Dies ist Absatz ", 0), ("Nummer 3", 1), (", geschrieben, um den ", 2), ("Übersetzer ", 3), ("beschäftigt ", 4), ("zu halten", 2), (".", 4)])
    let parts = LinkedPieces.parts(of: answer, over: ["This is paragraph ", "number 3", ", written to keep the ", "translator", " busy."])
    XCTAssertEqual(parts, ["Dies ist Absatz ", "Nummer 3", ", geschrieben, um den zu halten", "Übersetzer ", "beschäftigt ."])
  }

  func testAJapaneseReorderPutsTheSettingsWordInTheSettingsNode() {
    let parts = LinkedPieces.parts(of: answer([("設定", 1), ("を開いて", 0), ("変更してください。", 2)]), over: ["Open ", "the settings", " to change it."])
    XCTAssertEqual(parts, ["を開いて", "設定", "変更してください。"])
  }

  func testUntaggedTextFollowsTheRunBeforeIt() {
    let parts = LinkedPieces.parts(of: answer([("« ", nil), ("Lisez", 0), (" les ", nil), ("notes", 1)]), over: ["Read the ", "notes"])
    XCTAssertEqual(parts, ["« Lisez les ", "notes"])
  }

  func testAPieceLeftWithOnlySpaceFails() {
    XCTAssertNil(LinkedPieces.parts(of: answer([("Bonjour", 0), (" ", 1)]), over: ["Hello ", "world"]))
  }
}
