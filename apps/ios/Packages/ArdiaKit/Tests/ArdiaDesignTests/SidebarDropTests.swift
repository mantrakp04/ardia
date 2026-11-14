import ArdiaDesign
import Foundation
import Testing

struct SidebarDropTests {
  @Test func `a dropped web link opens as itself`() {
    #expect(SidebarDrop.destination(for: "https://www.swift.org/blog/") == .page(URL(string: "https://www.swift.org/blog/")!))
    #expect(SidebarDrop.destination(for: "http://example.com") == .page(URL(string: "http://example.com")!))
  }

  @Test func `surrounding space and a trailing newline are ignored`() {
    #expect(SidebarDrop.destination(for: "  https://example.com/a\n") == .page(URL(string: "https://example.com/a")!))
  }

  @Test func `a bare host gets https`() {
    #expect(SidebarDrop.destination(for: "apple.com") == .page(URL(string: "https://apple.com")!))
    #expect(SidebarDrop.destination(for: "en.wikipedia.org/wiki/Sintra") == .page(URL(string: "https://en.wikipedia.org/wiki/Sintra")!))
  }

  @Test func `ordinary text becomes a search`() {
    #expect(SidebarDrop.destination(for: "pastéis de nata") == .search("pastéis de nata"))
    #expect(SidebarDrop.destination(for: "swift") == .search("swift"))
    #expect(SidebarDrop.destination(for: "version 1.2") == .search("version 1.2"))
  }

  @Test func `lines of dropped text are joined into one search`() {
    #expect(SidebarDrop.destination(for: "best time\n to visit\tsintra") == .search("best time to visit sintra"))
  }

  @Test func `a long selection is cut to a search the engine can take`() {
    let long = String(repeating: "word ", count: 400)
    guard case .search(let query) = SidebarDrop.destination(for: long) else {
      Issue.record("expected a search")
      return
    }
    #expect(query.count <= SidebarDrop.maxQueryLength)
    #expect(!query.hasSuffix(" "))
  }

  @Test func `script, data and file links never open as pages`() {
    #expect(SidebarDrop.destination(for: "javascript:alert(1)") == .search("javascript:alert(1)"))
    #expect(SidebarDrop.destination(for: "data:text/html,hi") == .search("data:text/html,hi"))
    #expect(SidebarDrop.destination(for: "file:///etc/hosts") == .search("file:///etc/hosts"))
  }

  @Test func `a dropped URL object opens only when it is a web page`() {
    #expect(SidebarDrop.destination(for: URL(string: "https://example.com")!) == .page(URL(string: "https://example.com")!))
    #expect(SidebarDrop.destination(for: URL(string: "file:///tmp/a.html")!) == nil)
    #expect(SidebarDrop.destination(for: URL(string: "javascript:void(0)")!) == nil)
  }

  @Test func `empty drops do nothing`() {
    #expect(SidebarDrop.destination(for: "") == nil)
    #expect(SidebarDrop.destination(for: "  \n\t ") == nil)
  }
}

struct RowReorderTests {
  @Test func `a row dragged down lands before the row it was dropped above`() {
    let moved = RowReorder.move(IndexSet(integer: 0), toOffset: 3)
    #expect(moved?.source == 0)
    #expect(moved?.index == 2)
  }

  @Test func `a row dragged up lands at the drop offset`() {
    let moved = RowReorder.move(IndexSet(integer: 4), toOffset: 1)
    #expect(moved?.source == 4)
    #expect(moved?.index == 1)
  }

  @Test func `dropping a row where it already is moves nothing`() {
    #expect(RowReorder.move(IndexSet(integer: 2), toOffset: 2) == nil)
    #expect(RowReorder.move(IndexSet(integer: 2), toOffset: 3) == nil)
  }

  @Test func `several rows at once are left alone`() {
    #expect(RowReorder.move(IndexSet([1, 2]), toOffset: 0) == nil)
    #expect(RowReorder.move(IndexSet(), toOffset: 0) == nil)
  }
}

struct ListHighlightTests {
  @Test func `arrows start at the ends and stop at the edges of the list`() {
    #expect(ListHighlight.moved(from: nil, by: 1, count: 4) == 0)
    #expect(ListHighlight.moved(from: nil, by: -1, count: 4) == 3)
    #expect(ListHighlight.moved(from: 0, by: 1, count: 4) == 1)
    #expect(ListHighlight.moved(from: 3, by: 1, count: 4) == 3)
    #expect(ListHighlight.moved(from: 0, by: -1, count: 4) == 0)
    #expect(ListHighlight.moved(from: 2, by: 1, count: 0) == nil)
  }
}

struct SidebarRowDragTests {
  @Test func `a regular web tab drags out as its link`() {
    #expect(SidebarDrop.exportedLink(url: "https://www.swift.org/blog/", isPrivate: false) == URL(string: "https://www.swift.org/blog/"))
  }

  @Test func `an incognito tab or a page that is not on the web drags out nothing`() {
    #expect(SidebarDrop.exportedLink(url: "https://example.com", isPrivate: true) == nil)
    #expect(SidebarDrop.exportedLink(url: "about:blank", isPrivate: false) == nil)
  }

  @Test func `a drop that started as one of the sidebar's own rows opens nothing`() {
    #expect(!SidebarDrop.accepts(typeIdentifiers: ["public.url", SidebarDrop.ownRowType]))
    #expect(SidebarDrop.accepts(typeIdentifiers: ["public.url"]))
    #expect(SidebarDrop.accepts(typeIdentifiers: ["public.plain-text"]))
  }
}
