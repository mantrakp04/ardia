import ExpoModulesCore

struct MenuStateUpdate: Record {
  @Field var checked: [String] = []
  @Field var disabled: [String] = []
  @Field var titles: [String: String] = [:]
  @Field var profiles: [MenuEntry] = []
  @Field var windows: [MenuEntry] = []
  @Field var recentlyClosed: [MenuEntry] = []
  @Field var recentlyClosedGroups: [MenuEntry] = []
  @Field var warnBeforeQuitting: Bool = false
  @Field var warnBeforeClosingWindow: Bool = false
  @Field var undoReopensClosedTab: Bool = false
  @Field var downloadsInProgress: Int = 0
  @Field var extensions: [MenuExtension] = []
  @Field var shortcuts: [String: [[String]]] = [:]
}
