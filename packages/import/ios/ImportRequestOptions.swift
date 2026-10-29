import ExpoModulesCore

struct ImportRequestOptions: Record {
  @Field var historyLimit: Int?
  @Field var historySince: Double?
  @Field var spaceIds: [String]?
  @Field var chunkSize: Int?
  @Field var streamHistory: Bool = false

  var importOptions: ImportOptions {
    ImportOptions(historyLimit: historyLimit, historySince: historySince, spaceIds: spaceIds.map(Set.init), streamHistory: streamHistory)
  }
}
