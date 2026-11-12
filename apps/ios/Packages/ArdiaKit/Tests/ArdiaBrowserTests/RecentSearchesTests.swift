import ArdiaBrowser
import Testing

struct RecentSearchesTests {
  @Test func `reads the query from a search engine address`() {
    #expect(RecentSearches.query(in: "https://www.google.com/search?q=big+nate&hl=en") == "big nate")
    #expect(RecentSearches.query(in: "https://duckduckgo.com/?q=sintra") == "sintra")
    #expect(RecentSearches.query(in: "https://www.youtube.com/results?search_query=dogs") == nil)
  }

  @Test func `ignores pages that are not searches`() {
    #expect(RecentSearches.query(in: "https://en.wikipedia.org/wiki/Lisbon") == nil)
    #expect(RecentSearches.query(in: "https://www.google.com/maps") == nil)
    #expect(RecentSearches.query(in: "https://notgoogle.com/search?q=x") == nil)
  }

  @Test func `keeps the newest of each query once, up to the limit`() {
    let urls = [
      "https://www.google.com/search?q=magnesium",
      "https://en.wikipedia.org/wiki/Sintra",
      "https://www.google.com/search?q=Magnesium",
      "https://www.bing.com/search?q=big+nate",
      "https://www.google.com/search?q=pancakes",
    ]
    #expect(RecentSearches.queries(fromNewestFirst: urls, limit: 2) == ["magnesium", "big nate"])
    #expect(RecentSearches.queries(fromNewestFirst: urls, limit: 9) == ["magnesium", "big nate", "pancakes"])
  }
}
