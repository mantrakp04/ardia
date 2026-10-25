import Foundation
import Testing
import WebKit
@testable import ArdiaBrowser

struct ConvertedRule: Decodable {
  struct Trigger: Decodable {
    var urlFilter: String
    var resourceType: [String]?
    var loadType: [String]?
    var loadContext: [String]?
    var ifDomain: [String]?
    var unlessDomain: [String]?

    enum CodingKeys: String, CodingKey {
      case urlFilter = "url-filter"
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

  static func decode(_ conversion: FilterConversion) throws -> [ConvertedRule] {
    try JSONDecoder().decode([ConvertedRule].self, from: Data(conversion.json.utf8))
  }
}

let easyListSample = """
[Adblock Plus 2.0]
! Title: EasyList
! Comment line ||ignored.com^
||doubleclick.net^
||ads.example.com^$third-party
||tracker.example^$script,image,domain=news.example|blog.example
||mixed.example^$domain=a.example|~b.example
||popunder.example^$popup
||frames.example^$subdocument
||notscript.example^$~script
||csp.example^$csp=script-src 'none'
||redirect.example^$redirect=noopjs
||removeparam.example^$removeparam=utm_source
||badfilter.example^$badfilter
||path.example/ads/*.js
/banner/*/img^
||ADS.UPPER.example^
@@||cdn.example.com^$script
@@||trusted.example^$document
@@||news.example^$elemhide
##.ad-banner
##.ad-banner
###sponsored-box
##div[id^="google_ads_iframe"]
##.adsbox:-abp-has(.foo)
##.promo:has(> .ad)
##a[href*="click"]:contains(Sponsored)
##::selection
##.broken[
example.com##.local-ad
example.com,shop.example.com##.shop-ad
~excluded.example##.everywhere-but
a.example,~b.example##.mixed-domains
example.com#@#.local-ad
#@#.adsbox
##.adsbox
example.com#?#.procedural:has-text(Ad)
example.com#$#.inject { display: none }
example.com##+js(nobab)
##^script:has-text(ad)
bücher.example##.idn
||xn--bcher-kva.example^
garbage line without markers
"""

@Suite struct FilterListConverterTests {
  @Test func convertsNetworkRulesAndSkipsWhatWebKitCantExpress() throws {
    let conversion = FilterListConverter.convert(easyListSample)
    let rules = try ConvertedRule.decode(conversion)
    let blocks = rules.filter { $0.action.type == "block" }
    let filters = blocks.map(\.trigger.urlFilter)

    #expect(filters.contains(#"^[^:]+://+([^:/]+\.)?doubleclick\.net[:/]"#))
    #expect(filters.contains(#"^[^:]+://+([^:/]+\.)?ads\.upper\.example[:/]"#))
    #expect(filters.contains(#"^[^:]+://+([^:/]+\.)?xn--bcher-kva\.example[:/]"#))
    for skipped in ["csp", "redirect", "removeparam", "badfilter", "mixed", "path", "banner", "ignored"] {
      #expect(!filters.contains { $0.contains(skipped) }, "\(skipped) should be skipped")
    }

    let thirdParty = try #require(blocks.first { $0.trigger.urlFilter.contains("ads\\.example") })
    #expect(thirdParty.trigger.loadType == ["third-party"])
    let scoped = try #require(blocks.first { $0.trigger.urlFilter.contains("tracker") })
    #expect(scoped.trigger.resourceType == ["script", "image"])
    #expect(scoped.trigger.ifDomain == ["*news.example", "*blog.example"])
    #expect(blocks.first { $0.trigger.urlFilter.contains("popunder") }?.trigger.resourceType == ["popup"])
    let frames = try #require(blocks.first { $0.trigger.urlFilter.contains("frames") })
    #expect(frames.trigger.resourceType == ["document"])
    #expect(frames.trigger.loadContext == ["child-frame"])
    let notScript = try #require(blocks.first { $0.trigger.urlFilter.contains("notscript") })
    #expect(notScript.trigger.resourceType?.contains("script") == false)
    #expect(notScript.trigger.resourceType?.contains("image") == true)

    #expect(conversion.blockedDomains.contains("doubleclick.net"))
    #expect(conversion.blockedDomains.contains("ads.example.com"))
    #expect(!conversion.blockedDomains.contains("tracker.example"))
  }

  @Test func exceptionsComeAfterWhatTheyOverride() throws {
    let rules = try ConvertedRule.decode(FilterListConverter.convert(easyListSample))
    let lastBlock = try #require(rules.lastIndex { $0.action.type == "block" })
    let cdn = try #require(rules.firstIndex { $0.action.type == "ignore-previous-rules" && $0.trigger.urlFilter.contains("cdn") })
    #expect(cdn > lastBlock)
    #expect(rules[cdn].trigger.resourceType == ["script"])
    let lastHide = try #require(rules.lastIndex { $0.action.type == "css-display-none" })
    let documents = rules.enumerated().filter { $0.element.action.type == "ignore-previous-rules" && $0.element.trigger.urlFilter == ".*" }
    #expect(documents.map(\.element.trigger.ifDomain) == [["*trusted.example"], ["*news.example"]])
    #expect(documents.allSatisfy { $0.offset > lastHide })
  }

  @Test func elementHidingKeepsOnlySelectorsWebKitAccepts() throws {
    let rules = try ConvertedRule.decode(FilterListConverter.convert(easyListSample))
    let hides = rules.filter { $0.action.type == "css-display-none" }
    let generic = try #require(hides.first { $0.trigger.ifDomain == nil && $0.trigger.unlessDomain == nil })
    #expect(generic.action.selector == #".ad-banner, #sponsored-box, div[id^="google_ads_iframe"]"#)
    let scoped = hides.filter { $0.trigger.ifDomain != nil }
    #expect(scoped.map(\.action.selector) == [".shop-ad"])
    #expect(scoped.first?.trigger.ifDomain == ["*example.com", "*shop.example.com"])
    #expect(hides.first { $0.trigger.unlessDomain != nil }?.action.selector == ".everywhere-but")
    let all = hides.compactMap(\.action.selector).joined(separator: " ")
    for absent in ["adsbox", "local-ad", "promo", "contains", "selection", "broken", "mixed-domains", "procedural", "inject", "idn"] {
      #expect(!all.contains(absent), "\(absent) should not be hidden")
    }
  }

  @Test func capsAtTheRuleLimitAndStaysValidJSON() throws {
    let lines = (0..<500).map { "||host\($0).example^" } + (0..<10).map { "##.hide-\($0)" }
    let conversion = FilterListConverter.convert(lines.joined(separator: "\n"), limit: 300)
    let rules = try ConvertedRule.decode(conversion)
    #expect(rules.count == 300)
    #expect(conversion.ruleCount == 300)
    #expect(FilterListConverter.convert("").json == "[]")
    #expect(try ConvertedRule.decode(FilterListConverter.convert("! only comments\n[Adblock]\n")).isEmpty)
  }

  @Test(arguments: [
    (".a > .b:not(.c)", true),
    ("div[class*=\"x:y\"]", true),
    (".a:nth-child(2n+1)", true),
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
