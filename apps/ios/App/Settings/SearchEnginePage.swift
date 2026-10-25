import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SearchEnginePage: View {
  @Environment(AppModel.self) private var app
  @State private var engines: [EngineChoice] = SearchEngineNames.fallback

  var body: some View {
    let synced = app.sync.isEnabled ? app.sync.snapshot.search : nil
    Form {
      if let synced {
        Section {
          LabeledContent {
            Text(SearchEngineNames.name(for: synced, engines: engines))
          } label: {
            Label("From Your Mac", systemImage: "macbook")
          }
        } footer: {
          Text("Ardia uses the search engine you chose on your Mac. To change it, open Ardia Settings on your Mac and choose another under Search.")
        }
      } else {
        Section {
          ForEach(engines) { engine in
            Button {
              app.preferences.searchEngineID = engine.id
              app.applySyncedSearch()
            } label: {
              HStack {
                Text(verbatim: engine.name)
                  .foregroundStyle(.primary)
                Spacer()
                if engine.id == app.preferences.searchEngineID {
                  Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.indigo)
                    .accessibilityHidden(true)
                }
              }
            }
            .accessibilityAddTraits(engine.id == app.preferences.searchEngineID ? .isSelected : [])
          }
        } footer: {
          Text("Searches from the start screen go to this engine. Browse for Me reads its results too.")
        }
      }
    }
    .navigationTitle("Search Engine")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      guard let omnibox = app.web.omnibox else { return }
      let loaded = await omnibox.engines().filter { $0.custom != true }.map { EngineChoice(id: $0.id, name: $0.name) }
      if !loaded.isEmpty { engines = loaded }
    }
  }
}

enum SearchEngineNames {
  static let fallback: [EngineChoice] = [
    EngineChoice(id: "google", name: "Google"),
    EngineChoice(id: "bing", name: "Bing"),
    EngineChoice(id: "duckduckgo", name: "DuckDuckGo"),
    EngineChoice(id: "ecosia", name: "Ecosia"),
    EngineChoice(id: "brave", name: "Brave Search"),
    EngineChoice(id: "kagi", name: "Kagi"),
    EngineChoice(id: "startpage", name: "Startpage"),
    EngineChoice(id: "yahoo", name: "Yahoo"),
  ]

  @MainActor
  static func current(_ app: AppModel) -> String {
    if app.sync.isEnabled, let synced = app.sync.snapshot.search {
      return name(for: synced, engines: fallback)
    }
    return name(id: app.preferences.searchEngineID, engines: fallback)
  }

  static func name(for synced: SyncedSearch, engines: [EngineChoice]) -> String {
    if let custom = synced.customEngines.first(where: { $0.id == synced.engineId }) { return custom.name }
    if synced.engineId == "custom" { return String(localized: "Custom") }
    return name(id: synced.engineId, engines: engines)
  }

  static func name(id: String, engines: [EngineChoice]) -> String {
    engines.first(where: { $0.id == id })?.name ?? fallback.first(where: { $0.id == id })?.name ?? id.capitalized
  }
}

struct EngineChoice: Identifiable, Hashable {
  var id: String
  var name: String
}
