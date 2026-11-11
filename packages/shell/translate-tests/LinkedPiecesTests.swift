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

  func testAPieceTheModelSplitsAroundAnotherIsSharedOutInReadingOrder() {
    let answer = answer([("Dies ist Absatz ", 0), ("Nummer 3", 1), (", geschrieben, um den ", 2), ("Übersetzer ", 3), ("beschäftigt ", 4), ("zu halten", 2), (".", 4)])
    let parts = LinkedPieces.parts(of: answer, over: ["This is paragraph ", "number 3", ", written to keep the ", "translator", " busy."])
    XCTAssertEqual(parts?.count, 5)
    XCTAssertEqual(parts?.joined(), "Dies ist Absatz Nummer 3, geschrieben, um den Übersetzer beschäftigt zu halten.")
    XCTAssertTrue(parts?.allSatisfy { !$0.isEmpty } ?? false)
  }

  func testAReorderedAnswerIsSharedOutWithoutEmptyParts() {
    let parts = LinkedPieces.parts(of: answer([("設定", 1), ("を開いて", 0), ("変更してください。", 2)]), over: ["Open ", "the settings", " to change it."])
    XCTAssertEqual(parts?.count, 3)
    XCTAssertEqual(parts?.joined(), "設定を開いて変更してください。")
    XCTAssertTrue(parts?.allSatisfy { !$0.isEmpty } ?? false)
  }

  func testAReorderTooShortToShareOutFails() {
    XCTAssertNil(LinkedPieces.parts(of: answer([("Y", 1), ("X", 0), ("Z", 2)]), over: ["a", "b", "a much longer third piece"]))
  }
}
