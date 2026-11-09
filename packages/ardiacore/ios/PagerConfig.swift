import ExpoModulesCore

struct PagerConfig: Record {
  @Field var key: String = ""
  @Field var selected: Int = 0
  @Field var count: Int = 1
  @Field var width: Double = 0
  @Field var ack: Int = 0
  @Field var order: [String]?
}
