import ExpoModulesCore

struct ScriptWindowState: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var profileId: String = ""
  @Field var incognito: Bool = false
  @Field var activeTabId: String?
  @Field var tabs: [ScriptTabState] = []
}
