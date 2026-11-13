import ArdiaDesign
import Testing

struct AddressSummaryTests {
  static func summary(_ address: String, title: String = "", security: AddressSecurity = .secure, isPrivate: Bool = false, hasFavicon: Bool = false) -> AddressSummary {
    AddressSummary(address: address, title: title, security: security, isPrivate: isPrivate, hasFavicon: hasFavicon, placeholder: "Search")
  }

  @Test func `a secure page shows its host with a lock, or its icon when it has one`() {
    let plain = Self.summary("https://www.wikipedia.org/wiki/Sintra")
    #expect(plain.text == "wikipedia.org")
    #expect(plain.glyph == .lock)
    #expect(plain.labelGlyph == .lock)
    #expect(plain.kind == .web)
    #expect(!plain.isNotSecure)
    let withIcon = Self.summary("https://en.wikipedia.org/", hasFavicon: true)
    #expect(withIcon.glyph == .favicon)
    #expect(withIcon.labelGlyph == .favicon)
  }

  @Test func `plain http and mixed content read as not secure`() {
    let http = Self.summary("http://example.com/page", security: .insecure, hasFavicon: true)
    #expect(http.isNotSecure)
    #expect(http.glyph == .notSecure)
    #expect(http.text == "example.com")
    #expect(Self.summary("https://example.com", security: .mixed).glyph == .notSecure)
    #expect(Self.summary("http://example.com", security: .unknown).isNotSecure)
  }

  @Test func `beside the words a page that is not secure has no picture, so the words carry the warning`() {
    let http = Self.summary("http://example.com/page", security: .insecure, hasFavicon: true)
    #expect(http.labelGlyph == nil)
    #expect(Self.summary("https://example.com", security: .mixed).labelGlyph == nil)
    #expect(Self.summary("https://example.com", hasFavicon: true).labelGlyph == .favicon)
  }

  @Test func `private browsing shows the glasses unless the page is not secure`() {
    let secure = Self.summary("https://example.com", isPrivate: true, hasFavicon: true)
    #expect(secure.isPrivate)
    #expect(secure.glyph == .privateBrowsing)
    #expect(secure.glyph.symbolName == "eyeglasses")
    #expect(Self.summary("http://example.com", security: .insecure, isPrivate: true).glyph == .notSecure)
  }

  @Test func `beside the words a private tab always shows the glasses, even on a page that is not secure`() {
    let secure = Self.summary("https://example.com", isPrivate: true, hasFavicon: true)
    #expect(secure.labelGlyph == .privateBrowsing)
    #expect(!secure.isNotSecure)
    let insecure = Self.summary("http://example.com", security: .insecure, isPrivate: true)
    #expect(insecure.labelGlyph == .privateBrowsing)
    #expect(insecure.isNotSecure)
    #expect(Self.summary("", security: .unknown, isPrivate: true).labelGlyph == .privateBrowsing)
  }

  @Test func `an empty tab shows the placeholder with a search glyph`() {
    for address in ["", "about:blank", "  "] {
      let empty = Self.summary(address, security: .unknown)
      #expect(empty.kind == .empty)
      #expect(empty.text == "Search")
      #expect(empty.glyph == .search)
      #expect(empty.labelGlyph == .search)
      #expect(!empty.isNotSecure)
    }
  }

  @Test func `files show their name`() {
    let file = Self.summary("file:///var/mobile/Downloads/report.pdf", security: .unknown)
    #expect(file.kind == .file)
    #expect(file.text == "report.pdf")
    #expect(file.glyph == .document)
  }

  @Test func `a page's own title never stands in for its address`() {
    let data = Self.summary("data:text/html,hello", title: "accounts.google.com", security: .unknown)
    #expect(data.kind == .other)
    #expect(data.text == "data")
    #expect(data.isNotSecure)
    #expect(data.glyph == .notSecure)
    #expect(data.labelGlyph == nil)
    let blob = Self.summary("blob:https://evil.example/1234", title: "accounts.google.com", security: .secure)
    #expect(blob.kind == .other)
    #expect(blob.text == "evil.example")
    #expect(blob.isNotSecure)
    let popup = Self.summary("about:blank#accounts.google.com", title: "accounts.google.com", security: .unknown)
    #expect(popup.kind == .other)
    #expect(popup.text == "about")
    #expect(popup.isNotSecure)
    #expect(Self.summary("blob:null/5", title: "accounts.google.com", security: .unknown).text == "blob")
    #expect(Self.summary("javascript:void(0)", title: "accounts.google.com", security: .unknown).text == "javascript")
  }

  @Test func `a private page that is not secure keeps both cues`() {
    let privateInsecure = Self.summary("http://example.com", security: .insecure, isPrivate: true)
    #expect(privateInsecure.railGlyph == .privateBrowsing)
    #expect(privateInsecure.railBadge == .notSecure)
    let privateOther = Self.summary("data:text/html,x", title: "bank.com", security: .unknown, isPrivate: true)
    #expect(privateOther.labelGlyph == .privateBrowsing)
    #expect(privateOther.railBadge == .notSecure)
    let insecure = Self.summary("http://example.com", security: .insecure)
    #expect(insecure.railGlyph == .notSecure)
    #expect(insecure.railBadge == nil)
    let secure = Self.summary("https://example.com", isPrivate: true)
    #expect(secure.railGlyph == .privateBrowsing)
    #expect(secure.railBadge == nil)
  }

  @Test func `the app's own links read as an empty tab`() {
    let own = Self.summary("ardia://search?q=sintra", title: "accounts.google.com", security: .unknown)
    #expect(own.kind == .empty)
    #expect(own.text == "Search")
    #expect(!own.isNotSecure)
  }
}
