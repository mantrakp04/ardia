import XCTest
@testable import ArdiaTranslateCore

@MainActor
final class PassageDispatchTests: XCTestCase {
  private final class Model {
    var plainCalls: [String] = []
    var linkedCalls: [[String]] = []
    var failLinked = false

    func plain(_ text: String) async -> String? {
      plainCalls.append(text)
      return text.uppercased()
    }

    func linked(_ pieces: [String]) async -> [String]? {
      linkedCalls.append(pieces)
      return failLinked ? nil : pieces.map { $0.uppercased() }
    }

    var largestRequest: Int {
      max(plainCalls.map(\.count).max() ?? 0, linkedCalls.map { $0.reduce(0) { $0 + $1.count } }.max() ?? 0)
    }
  }

  private func dispatch(_ pieces: [String], _ model: Model, limit: Int = 800) async -> [String]? {
    await PassageDispatch.translate(pieces, limit: limit, plain: { await model.plain($0) }, linked: { await model.linked($0) })
  }

  func testAShortStyledParagraphGoesAsOneLinkedRequest() async {
    let model = Model()
    let parts = await dispatch(["Read the ", "release notes", " for more."], model)
    XCTAssertEqual(parts, ["READ THE ", "RELEASE NOTES", " FOR MORE."])
    XCTAssertEqual(model.linkedCalls.count, 1)
    XCTAssertTrue(model.plainCalls.isEmpty)
  }

  func testAHugeParagraphFollowedByABoldWordNeverSendsMoreThanTheLimit() async {
    let model = Model()
    let prose = String(repeating: "word another longer word without any stop ", count: 450) + "end"
    let parts = await dispatch([prose, " word"], model)
    XCTAssertEqual(parts?.count, 2)
    XCTAssertEqual(parts?[0], prose.uppercased())
    XCTAssertEqual(parts?[1], " WORD")
    XCTAssertLessThanOrEqual(model.largestRequest, 800)
    XCTAssertGreaterThan(model.plainCalls.count, 20)
  }

  func testManySmallStyledPiecesAreGroupedUnderTheLimitAndEachKeepsItsOwnPart() async {
    let model = Model()
    let pieces = (0..<120).map { i in i % 2 == 0 ? "plain text number \(i) " : "link \(i)" }
    let parts = await dispatch(pieces, model)
    XCTAssertEqual(parts, pieces.map { $0.uppercased() })
    XCTAssertGreaterThan(model.linkedCalls.count, 1)
    XCTAssertLessThanOrEqual(model.largestRequest, 800)
    XCTAssertEqual(model.linkedCalls.flatMap { $0 }, pieces)
  }

  func testALongPieceBetweenShortOnesGoesAloneInSentenceRuns() async {
    let model = Model()
    let long = String(repeating: "A full sentence sits here. ", count: 80)
    let pieces = ["Intro ", "link", long, "outro ", "tail"]
    let parts = await dispatch(pieces, model)
    XCTAssertEqual(parts, pieces.map { $0.uppercased() })
    XCTAssertEqual(model.linkedCalls, [["Intro ", "link"], ["outro ", "tail"]])
    XCTAssertLessThanOrEqual(model.largestRequest, 800)
  }

  func testAFailedGroupFailsThePassage() async {
    let model = Model()
    model.failLinked = true
    let parts = await dispatch([String(repeating: "x ", count: 500), "a", "b"], model)
    XCTAssertNil(parts)
  }

  func testWithoutAttributedTranslationAStyledPassageFailsSoItsPiecesGoOneByOne() async {
    let model = Model()
    let parts = await PassageDispatch.translate(["Read the ", "notes"], plain: { await model.plain($0) }, linked: nil)
    XCTAssertNil(parts)
    XCTAssertTrue(model.plainCalls.isEmpty)
  }

  func testWithoutAttributedTranslationALongPieceStillGoesInBoundedPlainRuns() async {
    let model = Model()
    let prose = String(repeating: "word another longer word without any stop ", count: 450)
    let parts = await PassageDispatch.translate([prose], plain: { await model.plain($0) }, linked: nil)
    XCTAssertEqual(parts, [prose.uppercased()])
    XCTAssertLessThanOrEqual(model.largestRequest, 800)
    XCTAssertTrue(model.linkedCalls.isEmpty)
  }

  func testGroupsCoverEveryPieceInOrder() {
    XCTAssertEqual(PassageDispatch.groups(["aaaa", "bb", "cccccc", "d"], limit: 6), [0..<2, 2..<3, 3..<4])
    XCTAssertEqual(PassageDispatch.groups(["a"], limit: 6), [0..<1])
  }
}
