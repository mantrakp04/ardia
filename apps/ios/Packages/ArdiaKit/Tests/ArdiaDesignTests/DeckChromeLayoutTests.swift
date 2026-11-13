import ArdiaDesign
import SwiftUI
import Testing

struct DeckChromeLayoutTests {
  let phone = CGSize(width: 402, height: 874)
  let duo = CGSize(width: 466, height: 678)
  let duoCluster = CGRect(x: 383, y: 27, width: 54, height: 126)

  @Test func `on a phone the header and banner span the width and card titles sit a gap below them`() {
    let layout = DeckChromeLayout(container: phone, safeArea: EdgeInsets(top: 62, leading: 0, bottom: 34, trailing: 0), occlusions: [], showsBanner: true)
    #expect(layout.header == CGRect(x: BarMetrics.sideInset, y: 62 + TabsLayout.deckChromeTop, width: 402 - BarMetrics.sideInset * 2, height: TabsLayout.deckHeaderHeight))
    let banner = try! #require(layout.banner)
    #expect(banner.minY == layout.header.maxY + TabsLayout.deckChromeGap)
    #expect(layout.cardsTop == banner.maxY + TabsLayout.deckChromeToCards)
    let plain = DeckChromeLayout(container: phone, safeArea: EdgeInsets(top: 62, leading: 0, bottom: 34, trailing: 0), occlusions: [], showsBanner: false)
    #expect(plain.banner == nil)
    #expect(plain.cardsTop == plain.header.maxY + TabsLayout.deckChromeToCards)
  }

  @Test func `on the closed Duo the header and banner stop before the status cluster`() {
    let layout = DeckChromeLayout(container: duo, safeArea: EdgeInsets(), occlusions: [duoCluster], showsBanner: true)
    let banner = try! #require(layout.banner)
    for row in [layout.header, banner] {
      #expect(row.minX == BarMetrics.sideInset)
      #expect(row.maxX <= duoCluster.minX - BarMetrics.sideInset + 0.5)
    }
  }

  @Test func `on the closed Duo card titles start below the status cluster`() {
    let layout = DeckChromeLayout(container: duo, safeArea: EdgeInsets(), occlusions: [duoCluster], showsBanner: true)
    #expect(layout.cardsTop == duoCluster.maxY + TabsLayout.deckChromeToCards)
    let strip = TabsDeckGeometry(container: duo, safeTop: 0, safeBottom: 0, topInset: layout.cardsTop)
    #expect(strip.cardTitleTop >= duoCluster.maxY + TabsLayout.deckChromeToCards - 0.5)
  }

  @Test func `a reserved area near the bottom leaves the top alone`() {
    let low = CGRect(x: 383, y: 560, width: 54, height: 100)
    let layout = DeckChromeLayout(container: duo, safeArea: EdgeInsets(), occlusions: [low], showsBanner: false)
    #expect(layout.header.width == 466 - BarMetrics.sideInset * 2)
    #expect(layout.cardsTop == layout.header.maxY + TabsLayout.deckChromeToCards)
  }

  @Test func `with only safe-area insets each side keeps its own inset`() {
    let layout = DeckChromeLayout(container: duo, safeArea: EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 80), occlusions: [], showsBanner: true)
    #expect(layout.header.minX == BarMetrics.sideInset)
    #expect(abs(layout.header.maxX - (466 - 80)) < 0.5)
  }
}
