import AppIntents

struct TabEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Tab"
  static let defaultQuery = TabQuery()

  let id: String

  @Property(title: "Title") var title: String
  @Property(title: "URL") var url: URL?
  @Property(title: "Profile") var profile: ProfileEntity
  @Property(title: "Pinned") var isPinned: Bool

  init(tab: ScriptTabState) {
    id = tab.id
    title = tab.title
    url = URL(string: tab.url)
    profile = ProfileEntity(id: tab.profileId, name: ShellScripting.state.profiles.first { $0.id == tab.profileId }?.name ?? "")
    isPinned = tab.pinned
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(title.isEmpty ? url?.absoluteString ?? "New Tab" : title)", subtitle: "\(profile.name)")
  }

  @MainActor static var open: [TabEntity] {
    IntentBridge.regularTabs.map(TabEntity.init(tab:))
  }
}
