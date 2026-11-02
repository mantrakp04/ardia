import ExpoModulesCore

public class DocumentsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaDocuments")

    Function("readDocument") { (name: String) -> String? in DocumentStore.read(name) }
    Function("writeDocument") { (name: String, contents: String) in try DocumentStore.write(name, contents) }
    Function("removeDocument") { (name: String) in try DocumentStore.remove(name) }
    AsyncFunction("saveDocument") { (name: String, contents: String, promise: Promise) in
      try DocumentStore.write(name, contents) { error in
        if let error { promise.reject("ERR_SAVE_DOCUMENT", error.localizedDescription) } else { promise.resolve(nil) }
      }
    }
  }
}
