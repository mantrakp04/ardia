import ExpoModulesCore

public class LightsBarClipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaLightsBarClip")

    View(LightsBarClip.self) {
      Prop("holeLeft") { (view: LightsBarClip, value: Double) in view.holeLeft = value }
      Prop("holeRadius") { (view: LightsBarClip, value: Double) in view.holeRadius = value }
    }
  }
}
