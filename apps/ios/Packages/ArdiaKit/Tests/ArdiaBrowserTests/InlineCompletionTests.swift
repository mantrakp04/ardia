import ArdiaBrowser
import Testing

@Suite("Inline completion")
struct InlineCompletionTests {
  @Test("Typing through a completion keeps every character")
  func typingThroughCompletion() {
    var editor = InlineCompletionEditor(typed: "g")
    editor.receive(CompletionOffer(query: "g", completion: "github.com"))
    #expect(editor.suffix == "ithub.com")
    for character in "ithub" {
      #expect(editor.insert(String(character)) == .consumed)
    }
    #expect(editor.typed == "github")
    #expect(editor.display == "github.com")
  }

  @Test("A stale offer for an earlier prefix still completes the current text")
  func staleOfferStillConsistent() {
    var editor = InlineCompletionEditor(typed: "gi")
    editor.receive(CompletionOffer(query: "g", completion: "github.com"))
    #expect(editor.suffix == "thub.com")
  }

  @Test("A stale offer that no longer matches leaves the field alone")
  func staleOfferMismatch() {
    var editor = InlineCompletionEditor(typed: "gl")
    editor.receive(CompletionOffer(query: "g", completion: "github.com"))
    #expect(editor.suffix.isEmpty)
    #expect(editor.typed == "gl")
  }

  @Test("A current offer without a completion clears the suffix")
  func currentOfferClears() {
    var editor = InlineCompletionEditor(typed: "git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    #expect(editor.hasSuffix)
    editor.receive(CompletionOffer(query: "git", completion: nil))
    #expect(!editor.hasSuffix)
  }

  @Test("An offer for a different query without a completion is ignored")
  func pendingOfferKeepsSuffix() {
    var editor = InlineCompletionEditor(typed: "git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    editor.receive(CompletionOffer(query: "gi", completion: nil))
    #expect(editor.suffix == "hub.com")
  }

  @Test("A differing character drops the suffix and lets the keyboard insert")
  func divergingCharacter() {
    var editor = InlineCompletionEditor(typed: "git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    #expect(editor.insert("l") == .insertTyped)
    #expect(!editor.hasSuffix)
    #expect(editor.typed == "git")
  }

  @Test("Matching is case insensitive and keeps the typed case")
  func caseInsensitive() {
    var editor = InlineCompletionEditor(typed: "Gi")
    editor.receive(CompletionOffer(query: "Gi", completion: "github.com"))
    #expect(editor.suffix == "thub.com")
    #expect(editor.insert("T") == .consumed)
    #expect(editor.display == "GiThub.com")
  }

  @Test("Pasting text that continues the completion is consumed")
  func pasteContinuing() {
    var editor = InlineCompletionEditor(typed: "g")
    editor.receive(CompletionOffer(query: "g", completion: "github.com"))
    #expect(editor.insert("ithub.") == .consumed)
    #expect(editor.typed == "github.")
    #expect(editor.suffix == "com")
  }

  @Test("Delete removes the completion first, then suppresses new ones until typing")
  func deleteSuppresses() {
    var editor = InlineCompletionEditor(typed: "git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    #expect(editor.deleteBackward() == .consumed)
    #expect(editor.typed == "git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    #expect(!editor.hasSuffix)
    #expect(editor.deleteBackward() == .insertTyped)
    editor.syncTyped("gi")
    _ = editor.insert("t")
    editor.syncTyped("git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    #expect(editor.suffix == "hub.com")
  }

  @Test("Accepting folds the suffix into the typed text")
  func accept() {
    var editor = InlineCompletionEditor(typed: "git")
    editor.receive(CompletionOffer(query: "git", completion: "github.com"))
    editor.accept()
    #expect(editor.typed == "github.com")
    #expect(!editor.hasSuffix)
  }

  @Test("Empty text never shows a completion")
  func emptyText() {
    var editor = InlineCompletionEditor()
    editor.receive(CompletionOffer(query: "", completion: "github.com"))
    #expect(!editor.hasSuffix)
  }

  @Test("Stale binding values echoed back are not treated as outside edits")
  func echoFilter() {
    var echo = BindingEchoFilter()
    echo.pushed("g")
    echo.pushed("gi")
    echo.pushed("git")
    let external1 = echo.isExternal("g", current: "git")
    #expect(!external1)
    let external2 = echo.isExternal("gi", current: "git")
    #expect(!external2)
    let external3 = echo.isExternal("git", current: "git")
    #expect(!external3)
    let external4 = echo.isExternal("", current: "git")
    #expect(external4)
  }

  @Test("After syncing, an earlier value is an outside edit")
  func echoFilterAfterSync() {
    var echo = BindingEchoFilter()
    echo.pushed("gi")
    let external5 = echo.isExternal("gi", current: "gi")
    #expect(!external5)
    let external6 = echo.isExternal("gi", current: "github")
    #expect(external6)
  }
}
