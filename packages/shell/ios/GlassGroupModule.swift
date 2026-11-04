import ExpoModulesCore

public class GlassGroupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaGlassGroup")

    View(GlassGroup.self) {}
  }
}
