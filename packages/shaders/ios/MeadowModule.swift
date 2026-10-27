import ExpoModulesCore

public class MeadowModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaMeadow")

    AsyncFunction("debugState") { () -> [String: Any] in MeadowView.debugState }.runOnQueue(.main)

    AsyncFunction("debugEval") { (script: String, promise: Promise) in
      guard let view = MeadowView.live else { return promise.resolve(nil) }
      view.evaluate(script) { promise.resolve($0) }
    }.runOnQueue(.main)

    View(MeadowView.self) {
      Prop("night") { (view: MeadowView, night: Bool) in view.night = night }
      Events("onTone")
    }
  }
}
