import AppIntents
import ArdiaBrowser
import ArdiaDesign
import CoreSpotlight
import SwiftUI
import UIKit

enum SystemIntegration {
  static func register(_ app: AppModel) {
    AppDependencyManager.shared.add(dependency: app)
  }
}

extension View {
  func systemIntegrations(_ app: AppModel) -> some View {
    modifier(SystemIntegrationsModifier(app: app))
  }
}

struct SystemIntegrationsModifier: ViewModifier {
  let app: AppModel

  @Environment(\.scenePhase) private var scenePhase
  @State private var exporter = WidgetExporter()
  @State private var spotlight = SpotlightIndexer()
  private let events = SystemEvents.shared

  func body(content: Content) -> some View {
    content
      .onOpenURL { url in open(url) }
      .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
        if let url = activity.webpageURL { app.openWebLink(url, origin: .link) }
      }
      .onContinueUserActivity(CSSearchableItemActionType) { activity in
        guard let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return }
        if let id = SpotlightIndexer.tabID(fromItemIdentifier: identifier) { app.openTabFromSystem(id) }
      }
      .userActivity(NSUserActivityTypeBrowsingWeb, isActive: handoff != nil) { activity in
        guard let handoff else { return }
        activity.webpageURL = handoff.url
        activity.title = handoff.title
        activity.isEligibleForHandoff = true
        activity.isEligibleForSearch = false
        activity.isEligibleForPrediction = false
      }
      .onChange(of: events.pending.count, initial: true) { _, count in
        guard count > 0 else { return }
        for link in events.takeAll() { app.handle(link) }
      }
      .onChange(of: scenePhase, initial: true) { _, phase in
        guard phase == .active else { return }
        app.drainSystemInbox()
        updateQuickActions()
        exporter.export(widgetSnapshot, from: app)
        spotlight.update(from: app)
      }
      .onChange(of: widgetSnapshot) { _, snapshot in
        updateQuickActions()
        exporter.export(snapshot, from: app)
      }
      .onChange(of: spotlightKey) { _, _ in spotlight.update(from: app) }
      .task { await runDebugHooks() }
  }

  private func open(_ url: URL) {
    if let link = SystemLink(url) {
      app.handle(link)
      return
    }
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
    app.openWebLink(url, origin: .link)
  }

  private struct Handoff: Equatable {
    var url: URL
    var title: String
  }

  private var handoff: Handoff? {
    guard app.surface == .browsing, !app.isIncognito, let tab = app.tabs.selectedTab, !tab.isPrivate,
      BrowserURL.isSyncable(tab.url), let url = URL(string: tab.url)
    else { return nil }
    return Handoff(url: url, title: tab.title)
  }

  private var widgetSnapshot: SystemSnapshot {
    WidgetExporter.snapshot(for: app)
  }

  private var spotlightKey: Int {
    var hasher = Hasher()
    for tab in app.tabs.openTabs {
      hasher.combine(tab.id)
      hasher.combine(tab.title)
      hasher.combine(tab.url)
    }
    hasher.combine(app.tabs.archive.reduce(0) { $0 + $1.tabs.count })
    return hasher.finalize()
  }

  private func updateQuickActions() {
    UIApplication.shared.shortcutItems = QuickAction.items(browseForMe: app.isBrowseForMeAvailable)
  }

  private func runDebugHooks() async {
    #if DEBUG
      await SystemDebugHooks.run(app: app, open: open)
    #endif
  }
}
