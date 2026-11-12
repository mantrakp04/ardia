import ExpoModulesCore

struct MenuBookmark: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var url: String?
  @Field var children: [MenuBookmark]?
}
