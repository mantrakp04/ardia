import ExpoModulesCore

public class ScriptingModule: Module {
  private let lifetime = ModuleLifetime()

  public func definition() -> ModuleDefinition {
    Name("ArdiaScripting")
    Events(ShellEvents.Channel.scriptCommand.rawValue)

    OnCreate { self.lifetime.begin(self) { ShellEvents.retire(self) } }

    OnStartObserving(ShellEvents.Channel.scriptCommand.rawValue) { ShellEvents.attach(.scriptCommand, to: self, while: self.lifetime) }

    OnDestroy {
      self.lifetime.end()
      ShellEvents.detach(self)
    }

    AsyncFunction("setScriptState") { (state: ScriptState) in ShellScripting.state = state }.runOnQueue(.main)
    AsyncFunction("replyToScript") { (id: String, result: [String: Any]?, error: String?) in
      ShellScripting.reply(id, result: result, error: error)
    }.runOnQueue(.main)
  }
}
