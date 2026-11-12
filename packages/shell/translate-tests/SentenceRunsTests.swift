import XCTest
@testable import ArdiaTranslateCore

final class SentenceRunsTests: XCTestCase {
  private func check(_ text: String, limit: Int = 800, file: StaticString = #filePath, line: UInt = #line) -> [SentenceRun] {
    let runs = SentenceRuns.split(text, limit: limit)
    XCTAssertEqual(runs.map { $0.text + $0.gap }.joined(), text, "the runs put back together are the text", file: file, line: line)
    for run in runs { XCTAssertLessThanOrEqual(run.text.count, limit, file: file, line: line) }
    return runs
  }

  func testShortTextGoesWhole() {
    XCTAssertEqual(check("A short line. Another one."), [SentenceRun(text: "A short line. Another one.", gap: "")])
  }

  func testLongTextIsCutBetweenSentences() {
    let runs = check(String(repeating: "This is one sentence, quite ordinary. And another one follows here!  ", count: 40))
    XCTAssertEqual(runs.count, 4)
    XCTAssertTrue(runs.dropLast().allSatisfy { $0.text.hasSuffix(".") || $0.text.hasSuffix("!") })
    XCTAssertTrue(runs.dropLast().allSatisfy { $0.gap.allSatisfy(\.isWhitespace) && !$0.gap.isEmpty })
  }

  func testOneHugeSentenceWithoutPunctuationIsCutBetweenWords() {
    let text = String(repeating: "word another longer word without any stop ", count: 450) + "end"
    let runs = check(text)
    XCTAssertGreaterThanOrEqual(runs.count, 24)
    XCTAssertTrue(runs.dropLast().allSatisfy { $0.gap == " " })
    XCTAssertTrue(runs.allSatisfy { !$0.text.hasPrefix(" ") })
  }

  func testJapaneseWithoutSpacesIsCutBetweenWordsNotInsideThem() {
    let sentence = String(repeating: "日本語の文章はスペースを使わずに書かれていますが単語の区切りで分けられます", count: 40)
    let runs = check(sentence, limit: 200)
    XCTAssertGreaterThan(runs.count, 5)
    XCTAssertTrue(runs.allSatisfy { $0.gap.isEmpty })
  }

  func testArabicKeepsItsOrderAndCharacters() {
    let text = String(repeating: "هذه جملة عربية طويلة بدون نقطة في النهاية ", count: 60)
    let runs = check(text, limit: 300)
    XCTAssertGreaterThan(runs.count, 1)
    XCTAssertTrue(runs.allSatisfy { $0.text.first.map { !$0.isWhitespace } ?? true })
  }

  func testOneWordLongerThanTheLimitIsCutByCharacters() {
    let runs = check(String(repeating: "a", count: 1000), limit: 300)
    XCTAssertEqual(runs.map(\.text.count), [300, 300, 300, 100])
  }

  func testEmojiAreNeverCutApart() {
    let family = "👩‍👩‍👧"
    let runs = check(String(repeating: family, count: 1000), limit: 300)
    XCTAssertEqual(runs.map(\.text.count), [300, 300, 300, 100])
    XCTAssertTrue(runs.allSatisfy { $0.text.allSatisfy { String($0) == family } })
  }

  func testWhitespaceRunsAreKeptExactly() {
    let text = "  Leading space.\n\n" + String(repeating: "Sentence number here.   ", count: 60) + "\t"
    _ = check(text, limit: 100)
  }
}
