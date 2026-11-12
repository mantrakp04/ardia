import ExpoModulesCore

struct MenuBookmarks: Record {
  @Field var bookmarkFolders: [MenuEntry] = []
  @Field var recentBookmarks: [MenuBookmark] = []
  @Field var bookmarksBar: [MenuBookmark] = []
  @Field var otherBookmarks: [MenuBookmark] = []
}
