import ExpoModulesCore

struct ScriptState: Record {
  @Field var windows: [ScriptWindowState] = []
  @Field var profiles: [ScriptProfileState] = []
}
