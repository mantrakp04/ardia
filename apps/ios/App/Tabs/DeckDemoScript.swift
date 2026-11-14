import ArdiaBrowser
import ArdiaSync
import Foundation
import UIKit

extension AppModel {
  func runDeckDemoScript() async {
    guard isDemo else { return }
    let warming = Task { await DemoSnapshotWarmer.warm(self) }
    guard let script = UserDefaults.standard.string(forKey: "ArdiaDeck"), !script.isEmpty else { return }
    let steps = script.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
    if steps.contains(where: Self.showsDeck) {
      settings.autoOpensKeyboard = false
      browse.dismissSearch()
    }
    try? await Task.sleep(for: .seconds(1.2))
    for step in steps {
      if step == "warm" {
        await warming.value
      } else {
        await perform(deckStep: step)
      }
    }
  }

  private func perform(deckStep step: String) async {
    let parts = step.split(separator: ":").map(String.init)
    switch parts.first {
    case "wait":
      let seconds = parts.count > 1 ? Double(parts[1]) ?? 1 : 1
      try? await Task.sleep(for: .seconds(seconds))
    case "deck":
      showDemoDeck(.plain)
    case "open":
      deck.handoff = demoHandoff()
      showDemoDeck(deck.handoff.map { .fromPage($0.tabID) } ?? .plain)
    case "snapall":
      let limit = parts.count > 1 ? Int(parts[1]) ?? 6 : 6
      let ids = deckOrder.suffix(limit).map(\.id)
      for id in ids {
        openTab(id)
        try? await Task.sleep(for: .seconds(5))
        await web.existingWebTab(id)?.captureSnapshot()
      }
      if let last = ids.last { openTab(last) }
    case "switcher":
      browse.dismissSearch()
      showTabSwitcher()
    case "browse":
      if let id = tabs.selectedTabID { openTab(id) }
    case "scroll":
      deck.command = .init(kind: .scroll(parts.count > 1 ? Int(parts[1]) ?? 0 : 0))
    case "close":
      deck.command = .init(kind: .closeFocused)
    case "tap":
      deck.command = .init(kind: .openFocused)
    case "archivecard":
      deck.hasShownArchiveCard = false
      deck.command = .init(kind: .showArchiveCard)
    case "incognito":
      for url in ["https://en.wikipedia.org/wiki/Moon", "https://www.apple.com/"] {
        if let target = URL(string: url) { tabs.open(.url(target), isPrivate: true) }
      }
      showDemoDeck(.plain)
    case "lift":
      deck.command = .init(kind: .lift(parts.count > 1 ? Double(parts[1]) ?? -120 : -120))
    case "keep":
      let keep = parts.count > 1 ? Int(parts[1]) ?? 3 : 3
      for tab in deckOrder.dropLast(keep) { tabs.close(tab.id) }
    case "private":
      if let target = URL(string: "https://en.wikipedia.org/wiki/Moon") {
        let tab = tabs.open(.url(target), selecting: false, isPrivate: true)
        tabs.update(tab.id, title: "Moon - Wikipedia")
      }
    case "empty":
      tabs.closeAll()
      showDemoDeck(.plain)
    case "archive":
      sheet = .archive
    case "spaces":
      sheet = .syncedSpaces
    case "received":
      let received = ReceivedTab(key: "demo-received-\(UUID().uuidString)", url: "https://www.swift.org/blog/", title: "Blog | Swift.org", fromDevice: "MacBook Pro", sentAt: .now, profileSyncId: "demo-personal")
      tabs.receive([received])
    case "many":
      let count = parts.count > 1 ? Int(parts[1]) ?? 50 : 50
      for index in 0..<count {
        if let target = URL(string: "https://en.wikipedia.org/wiki/Special:Random?n=\(index)") {
          let tab = tabs.open(.url(target), selecting: false)
          tabs.update(tab.id, title: index.isMultiple(of: 7) ? "An exceptionally long article title that keeps going well past eighty characters to test truncation \(index)" : "Article \(index + 1)")
        }
      }
    default:
      break
    }
  }

  private static func showsDeck(_ step: String) -> Bool {
    ["deck", "open", "switcher", "incognito", "empty"].contains(step)
  }

  private func showDemoDeck(_ entrance: TabDeckModel.Entrance) {
    browse.dismissSearch()
    deck.entrance = entrance
    surface = .tabSwitcher
  }

  private func demoHandoff() -> TabDeckModel.Handoff? {
    guard let tab = tabs.selectedTab else { return nil }
    let size = CGSize(width: 393, height: 852)
    let format = UIGraphicsImageRendererFormat.preferred()
    format.opaque = true
    let title = TabText.title(for: tab)
    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      UIColor.systemBackground.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIColor(red: 0.19, green: 0.22, blue: 0.98, alpha: 1).setFill()
      context.fill(CGRect(x: 0, y: 0, width: size.width, height: 160))
      let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 30, weight: .bold), .foregroundColor: UIColor.label]
      (title as NSString).draw(in: CGRect(x: 20, y: 190, width: size.width - 40, height: 120), withAttributes: attributes)
      UIColor.secondarySystemFill.setFill()
      for row in 0..<12 {
        context.fill(CGRect(x: 20, y: 330 + CGFloat(row) * 34, width: row.isMultiple(of: 3) ? 220 : size.width - 40, height: 14))
      }
    }
    return TabDeckModel.Handoff(tabID: tab.id, image: image)
  }
}
