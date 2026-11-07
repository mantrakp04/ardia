import ExpoModulesCore

public class GlassGroupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaGlassGroup")

    View(GlassGroup.self) {
      Prop("strength") { (view: GlassGroup, value: Double?) in view.strength = value ?? 1 }
    }
  }
}
