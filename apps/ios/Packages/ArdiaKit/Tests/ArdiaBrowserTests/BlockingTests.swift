import Foundation
import Testing
import WebKit
@testable import ArdiaBrowser

struct ConvertedRule: Decodable {
  struct Trigger: Decodable {
    var urlFilter: String
    var caseSensitive: Bool?
    var resourceType: [String]?
    var loadType: [String]?
    var loadContext: [String]?
    var ifDomain: [String]?
    var unlessDomain: [String]?

    enum CodingKeys: String, CodingKey {
      case urlFilter = "url-filter"
      case caseSensitive = "url-filter-is-case-sensitive"
      case resourceType = "resource-type"
      case loadType = "load-type"
      case loadContext = "load-context"
      case ifDomain = "if-domain"
      case unlessDomain = "unless-domain"
    }
  }

  struct Action: Decodable {
    var type: String
    var selector: String?
  }

  var trigger: Trigger
  var action: Action

  static func decode(_ json: String) throws -> [ConvertedRule] {
    try JSONDecoder().decode([ConvertedRule].self, from: Data(json.utf8))
  }

  static func decode(_ conversion: FilterConversion) throws -> [ConvertedRule] {
    try decode(conversion.json)
  }
}

let easyListSample = #"""
[Adblock Plus 2.0]
! Title: EasyList
! Comment line ||ignored.com^
# hosts comment
0.0.0.0 hosts.example
127.0.0.1 localhost
||doubleclick.net^
||ads.example.com^$third-party
||tracker.example^$script,image,domain=news.example|blog.example
||mixed.example^$domain=a.example|~b.example
||popunder.example^$popup
||frames.example^$subdocument
||notscript.example^$~script
||sockets.example^$xhr,websocket,ping
||page.example^$doc
||CaseTest.example/Path$match-case
||redirect.example/ad.js$script,redirect=noopjs
||csp.example^$csp=script-src 'none'
||removeparam.example^$removeparam=utm_source
||badfilter.example^
||badfilter.example^$badfilter
||important.example^$important
||path.example/ads/*.js
|https://cdn.example/ads/
/banner/*/img^
/^https?:\/\/ad[0-9]+\.example\//$script
/ad(s|vert)/
ad
||ADS.UPPER.example^
@@||cdn.example.com^$script
@@||important.example^
@@||trusted.example^$document
@@||news.example^$elemhide
##.ad-banner
##.ad-banner
###sponsored-box
##div[id^="google_ads_iframe"]
##.card:has(> .sponsored)
##.adsbox:-abp-has(.foo)
##a[href*="click"]:has-text(Sponsored)
##::selection
##.broken[
example.com##.local-ad
example.com,shop.example.com##.shop-ad
example.com,~sub.example.com##.scoped-mixed
~excluded.example##.everywhere-but
example.com#@#.local-ad
#@#.adsbox
##.adsbox
example.com#?#.procedural:has-text(Ad)
example.com#$#.inject { display: none }
example.com##+js(nobab)
##^script:has-text(ad)
bücher.example##.idn
google.*##.tld-entity
||xn--bcher-kva.example^
"""#

@Suite struct FilterListConverterTests {
  let rules: [ConvertedRule]
  let conversion: FilterConversion

  init() throws {
    conversion = FilterListConverter.convert(easyListSample)
    rules = try ConvertedRule.decode(conversion)
  }

  func block(_ fragment: String) -> ConvertedRule? {
    rules.first { $0.action.type == "block" && $0.trigger.urlFilter.contains(fragment) }
  }

  @Test func convertsTheNetworkSyntax() throws {
    #expect(block("hosts\\.example")?.trigger.urlFilter == #"^[^:]+://+([^:/]+\.)?hosts\.example[:/]"#)
    #expect(block("localhost") == nil)
    #expect(block("doubleclick")?.trigger.urlFilter == #"^[^:]+://+([^:/]+\.)?doubleclick\.net[:/]"#)
    #expect(block("ads\\.upper\\.example") != nil)
    #expect(block("xn--bcher-kva") != nil)
    #expect(block("ads\\.example\\.com")?.trigger.loadType == ["third-party"])
    let scoped = try #require(block("tracker"))
    #expect(scoped.trigger.resourceType == ["script", "image"])
    #expect(scoped.trigger.ifDomain == ["*news.example", "*blog.example"])
    #expect(block("mixed")?.trigger.ifDomain == ["*a.example"])
    #expect(block("mixed")?.trigger.unlessDomain == nil)
    #expect(block("popunder")?.trigger.resourceType == ["popup"])
    #expect(block("frames")?.trigger.resourceType == ["document"])
    #expect(block("frames")?.trigger.loadContext == ["child-frame"])
    #expect(block("notscript")?.trigger.resourceType?.contains("script") == false)
    #expect(block("sockets")?.trigger.resourceType == ["raw", "ping"])
    #expect(block("page\\.example")?.trigger.resourceType == ["document"])
    #expect(block("casetest")?.trigger.caseSensitive == true)
    #expect(block("casetest")?.trigger.urlFilter == #"^[^:]+://+([^:/]+\.)?casetest\.example/Path"#)
    #expect(block("redirect")?.trigger.resourceType == ["script"])
    #expect(block("path\\.example")?.trigger.urlFilter == #"^[^:]+://+([^:/]+\.)?path\.example/ads/.*\.js"#)
    #expect(block("cdn\\.example/ads")?.trigger.urlFilter == #"^https://cdn\.example/ads/"#)
    #expect(block("banner")?.trigger.urlFilter == #"/banner/.*/img"#)
    #expect(block("ad[0-9]+")?.trigger.urlFilter == #"^https?:\/\/ad[0-9]+\.example\/"#)
    for absent in ["csp", "removeparam", "badfilter", "ad(s", "ignored"] {
      #expect(block(absent) == nil, "\(absent) should not block")
    }
    #expect(!rules.contains { $0.trigger.urlFilter == "ad" })
    #expect(conversion.blockedDomains.contains("doubleclick.net"))
    #expect(conversion.blockedDomains.contains("ads.example.com"))
    #expect(!conversion.blockedDomains.contains("tracker.example"))
    #expect(conversion.skippedLines >= 12)
  }

  @Test func exceptionsAndImportantRulesAreOrdered() throws {
    let lastBlock = try #require(rules.lastIndex { $0.action.type == "block" && !$0.trigger.urlFilter.contains("important") })
    let lastHide = try #require(rules.lastIndex { $0.action.type == "css-display-none" })
    let allow = try #require(rules.firstIndex { $0.action.type == "ignore-previous-rules" && $0.trigger.urlFilter.contains("cdn\\.example\\.com") })
    let importantAllow = try #require(rules.firstIndex { $0.action.type == "ignore-previous-rules" && $0.trigger.urlFilter.contains("important") })
    let important = try #require(rules.firstIndex { $0.action.type == "block" && $0.trigger.urlFilter.contains("important") })
    #expect(allow > lastBlock && allow > lastHide)
    #expect(important > importantAllow)
    let documents = rules.enumerated().filter { $0.element.action.type == "ignore-previous-rules" && $0.element.trigger.urlFilter == ".*" }
    #expect(documents.map(\.element.trigger.ifDomain) == [["*trusted.example"]])
    #expect(documents.allSatisfy { $0.offset > important })
    #expect(!rules.contains { $0.trigger.ifDomain == ["*news.example"] && $0.action.type == "ignore-previous-rules" })
  }

  @Test func elementHidingKeepsOnlySelectorsWebKitAccepts() throws {
    let hides = rules.filter { $0.action.type == "css-display-none" }
    let generic = try #require(hides.first { $0.trigger.ifDomain == nil && $0.trigger.unlessDomain == nil })
    #expect(generic.action.selector == #".ad-banner, #sponsored-box, div[id^="google_ads_iframe"], .card:has(> .sponsored)"#)
    let scoped = hides.filter { $0.trigger.ifDomain != nil }
    #expect(scoped.map(\.action.selector) == [".scoped-mixed", ".shop-ad"])
    #expect(scoped.first?.trigger.ifDomain == ["*example.com"])
    #expect(scoped.last?.trigger.ifDomain == ["*example.com", "*shop.example.com"])
    #expect(hides.first { $0.trigger.unlessDomain != nil }?.action.selector == ".everywhere-but")
    let all = hides.compactMap(\.action.selector).joined(separator: " ")
    for absent in ["adsbox", "local-ad", "has-text", "selection", "broken", "procedural", "inject", "idn", "tld-entity"] {
      #expect(!all.contains(absent), "\(absent) should not be hidden")
    }
  }

  @Test func capsAtTheRuleLimitAndStaysValidJSON() throws {
    let lines = (0..<500).map { "||host\($0).example^" } + (0..<10).map { "##.hide-\($0)" }
    let capped = FilterListConverter.convert(lines.joined(separator: "\n"), limit: 300)
    #expect(try ConvertedRule.decode(capped).count == 300)
    #expect(FilterListConverter.convert("").json == "[]")
    #expect(try ConvertedRule.decode(FilterListConverter.convert("! only comments\n[Adblock]\n")).isEmpty)
  }

  @Test func largeListsSplitAndEachChunkCarriesTheExceptionsThatMatter() throws {
    let big = FilterListConverter.parse((0..<1000).map { "||host\($0).example^" }.joined(separator: "\n"), id: "big")
    let unbreak = FilterListConverter.parse("@@||cdn.host7.example^\n@@||host999.example^$script\n@@/generic-pattern/", id: "unbreak")
    let chunks = FilterListConverter.build([big, unbreak], limit: 300)
    #expect(chunks.map(\.listID) == ["big", "big", "big", "big"])
    var blocked = 0
    for chunk in chunks {
      let decoded = try ConvertedRule.decode(chunk.json)
      #expect(decoded.count <= 300)
      let blocks = decoded.filter { $0.action.type == "block" }.map(\.trigger.urlFilter)
      let allows = decoded.filter { $0.action.type == "ignore-previous-rules" }.map(\.trigger.urlFilter)
      #expect(!allows.contains { $0.contains("generic-pattern") })
      #expect(allows.contains { $0.contains("cdn\\.host7") } == blocks.contains { $0.contains("?host7\\.example") })
      #expect(allows.contains { $0.contains("host999") } == blocks.contains { $0.contains("?host999\\.example") })
      if let firstAllow = decoded.firstIndex(where: { $0.action.type == "ignore-previous-rules" }) {
        #expect(decoded.lastIndex { $0.action.type == "block" } ?? 0 < firstAllow)
      }
      blocked += blocks.count
    }
    #expect(blocked == 1000)
    let mixed = FilterListConverter.parse("||host1.example^\n/banner/ad.js", id: "mixed")
    let mixedRules = try ConvertedRule.decode(try #require(FilterListConverter.build([mixed, unbreak]).first).json)
    #expect(mixedRules.contains { $0.action.type == "ignore-previous-rules" && $0.trigger.urlFilter.contains("generic-pattern") })
  }

  @Test func myFiltersWinOverListsInBothDirections() throws {
    let list = FilterListConverter.parse("||tracker.example^\n@@||ads.example^\n##.promo", id: "easylist")
    let mine = FilterListConverter.parse("||ads.example^\n@@||tracker.example^\n#@#.promo\nnews.example##.paywall", id: FilterLists.myFiltersID)
    let chunks = FilterListConverter.build([list, mine], ownerID: FilterLists.myFiltersID)
    let listRules = try ConvertedRule.decode(try #require(chunks.first { $0.listID == "easylist" }).json)
    let myRules = try ConvertedRule.decode(try #require(chunks.first { $0.listID == FilterLists.myFiltersID }).json)
    let listBlock = try #require(listRules.firstIndex { $0.action.type == "block" })
    let myAllowInList = try #require(listRules.firstIndex { $0.action.type == "ignore-previous-rules" && $0.trigger.urlFilter.contains("tracker") })
    #expect(myAllowInList > listBlock)
    #expect(!listRules.contains { $0.action.selector == ".promo" })
    let listAllowInMine = try #require(myRules.firstIndex { $0.action.type == "ignore-previous-rules" && $0.trigger.urlFilter.contains("ads") })
    let myBlock = try #require(myRules.firstIndex { $0.action.type == "block" && $0.trigger.urlFilter.contains("ads") })
    #expect(myBlock > listAllowInMine)
    #expect(myRules.contains { $0.action.selector == ".paywall" && $0.trigger.ifDomain == ["*news.example"] })
  }

  @Test(arguments: [
    (".a > .b:not(.c)", true),
    ("div[class*=\"x:y\"]", true),
    (".a:nth-child(2n+1)", true),
    (".a:has(.b)", true),
    (".a:hover", false),
    (".a::before", false),
    ("div[title='x]", false),
    (".a)(", false),
    (".a { color: red }", false),
    ("a\u{7}b", false),
  ])
  func selectorValidation(selector: String, valid: Bool) {
    #expect(FilterListConverter.isValidSelector(selector) == valid)
  }

  @Test(arguments: [
    (#"^https?:\/\/ads\.example\/"#, #"^https?:\/\/ads\.example\/"#),
    (#"\/ad\d+\.js"#, #"\/ad[0-9]+\.js"#),
    (#"(?:track|pixel)"#, nil),
    (#"ads{2}"#, nil),
    (#"ads(?=x)"#, nil),
    (#"\bads"#, nil),
    (#"a+?"#, nil),
  ] as [(String, String?)])
  func regexFiltersConvertOnlyWhenWebKitCanRunThem(source: String, expected: String?) {
    #expect(FilterListConverter.webKitRegex(source) == expected)
  }
}

@MainActor
@Suite struct BlockingSettingsTests {
  @Test func exemptionsPersistAndCoverSubdomains() throws {
    let suite = "ardia.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let settings = BlockingSettings(defaults: defaults)
    #expect(settings.blocksAds && settings.blocksTrackers && settings.hidesCookieBanners)
    settings.setExempt("WWW.Example.com", true)
    settings.blocksTrackers = false
    let reloaded = BlockingSettings(defaults: defaults)
    #expect(reloaded.exemptHosts == ["example.com"])
    #expect(reloaded.isExempt("example.com"))
    #expect(reloaded.isExempt("news.example.com"))
    #expect(!reloaded.isExempt("notexample.com"))
    #expect(!reloaded.isExempt("com"))
    #expect(!reloaded.isEnabled(.trackers))
    reloaded.setExempt("example.com", false)
    #expect(!BlockingSettings(defaults: defaults).isExempt("news.example.com"))
  }
}

@MainActor
@Suite(.serialized) struct RuleListCompileTests {
  @Test func seedAndConvertedListsCompileInWebKit() async throws {
    let directory = URL.temporaryDirectory.appending(path: "ardia-rules-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try #require(WKContentRuleListStore(url: directory))
    var sources = BlockingCategory.allCases.map { SeedRules.list(for: $0) }
    sources.append(easyListSample)
    for (index, source) in sources.enumerated() {
      let conversion = FilterListConverter.convert(source)
      #expect(conversion.ruleCount > 0)
      let list = try await store.compileContentRuleList(forIdentifier: "test.\(index)", encodedContentRuleList: conversion.json)
      #expect(list != nil)
    }
  }
}
