import ExpoModulesCore

struct ScriptTabState: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var url: String = ""
  @Field var loading: Bool = false
  @Field var pinned: Bool = false
}
