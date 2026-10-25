import Foundation
import JavaScriptCore

public struct ScriptError: Error, CustomStringConvertible, Sendable {
  public let message: String
  public var description: String { message }
}

public enum SharedScript: String, Sendable {
  case sync = "ardia-sync"
  case core = "ardia-core"

  var global: String {
    switch self {
    case .sync: "ArdiaSync"
    case .core: "ArdiaCore"
    }
  }
}

public final class ScriptEngine {
  public typealias HostFunction = ([String]) throws -> String

  private let context: JSContext
  private var lastException: String?

  public init(scripts: [SharedScript], extra: [String] = []) throws {
    guard let context = JSContext() else { throw ScriptError(message: "JavaScriptCore didn't start") }
    self.context = context
    context.name = scripts.map(\.rawValue).joined(separator: "+")
    context.exceptionHandler = { [weak self] _, value in
      let message = value?.objectForKeyedSubscript("message")?.toString() ?? value?.toString() ?? "unknown"
      let stack = value?.objectForKeyedSubscript("stack")?.toString() ?? ""
      self?.lastException = stack.isEmpty || stack == "undefined" ? message : "\(message)\n\(stack)"
    }
    let console: @convention(block) (String) -> Void = { message in
      #if DEBUG
      print("[js] \(message)")
      #endif
    }
    context.evaluateScript("globalThis.__log = null; globalThis.__host = {};")
    context.setObject(console, forKeyedSubscript: "__log" as NSString)
    context.evaluateScript("globalThis.console = { log: (...a) => __log(a.join(' ')), warn: (...a) => __log(a.join(' ')), error: (...a) => __log(a.join(' ')) };")
    context.evaluateScript("globalThis.__settle = (p, ok, bad) => Promise.resolve(p).then((v) => ok(JSON.stringify(v) ?? 'null'), (e) => bad(e));")
    for script in scripts {
      guard let url = SharedResources.bundle.url(forResource: script.rawValue, withExtension: "js", subdirectory: "Scripts"),
            let source = try? String(contentsOf: url, encoding: .utf8)
      else { throw ScriptError(message: "\(script.rawValue).js is missing from the app") }
      try evaluate(source, name: "\(script.rawValue).js")
    }
    for (index, source) in extra.enumerated() { try evaluate(source, name: "extra-\(index).js") }
  }

  @discardableResult
  public func evaluate(_ source: String, name: String = "eval.js") throws -> JSValue? {
    lastException = nil
    let value = context.evaluateScript(source, withSourceURL: URL(string: "ardia://\(name)"))
    if let lastException { throw ScriptError(message: lastException) }
    return value
  }

  public func register(_ name: String, _ body: @escaping HostFunction) {
    let block: @convention(block) () -> Any = { [weak self] in
      let arguments = (JSContext.currentArguments() as? [JSValue] ?? []).map { $0.isString ? $0.toString() ?? "" : $0.toString() ?? "" }
      do {
        return try body(arguments)
      } catch {
        self?.context.exception = JSValue(newErrorFromMessage: String(describing: error), in: self?.context)
        return JSValue(undefinedIn: self?.context) as Any
      }
    }
    context.objectForKeyedSubscript("__host").setObject(block, forKeyedSubscript: name as NSString)
  }

  public func call(_ script: SharedScript, _ function: String, json arguments: [String] = []) throws -> String {
    let result = try invoke(script, function, arguments)
    return result.isUndefined || result.isNull ? "null" : result.toString() ?? "null"
  }

  public func callAsync(_ script: SharedScript, _ function: String, json arguments: [String] = []) throws -> String {
    let promise = try invoke(script, function, arguments)
    var outcome: Result<String, ScriptError>?
    let fulfilled: @convention(block) (String) -> Void = { json in
      outcome = .success(json)
    }
    let rejected: @convention(block) (JSValue) -> Void = { value in
      let message = value.objectForKeyedSubscript("message")?.toString() ?? value.toString() ?? "rejected"
      let stack = value.objectForKeyedSubscript("stack")?.toString() ?? ""
      outcome = .failure(ScriptError(message: stack.isEmpty || stack == "undefined" ? message : "\(message)\n\(stack)"))
    }
    lastException = nil
    context.objectForKeyedSubscript("__settle").call(withArguments: [promise, unsafeBitCast(fulfilled, to: AnyObject.self), unsafeBitCast(rejected, to: AnyObject.self)])
    if let lastException { throw ScriptError(message: lastException) }
    guard let outcome else { throw ScriptError(message: "\(script.global).\(function) is waiting on something that never resolves") }
    return try outcome.get()
  }

  private func invoke(_ script: SharedScript, _ function: String, _ arguments: [String]) throws -> JSValue {
    lastException = nil
    guard let namespace = context.objectForKeyedSubscript(script.global), !namespace.isUndefined,
          let target = namespace.objectForKeyedSubscript(function), target.isObject
    else { throw ScriptError(message: "\(script.global).\(function) doesn't exist") }
    let parse = context.objectForKeyedSubscript("JSON").objectForKeyedSubscript("parse")!
    var values: [Any] = []
    for argument in arguments {
      let value = parse.call(withArguments: [argument])!
      if let lastException { throw ScriptError(message: "bad argument for \(function): \(lastException)") }
      values.append(value)
    }
    let stringify = context.objectForKeyedSubscript("JSON").objectForKeyedSubscript("stringify")!
    let raw = target.call(withArguments: values)!
    if let lastException { throw ScriptError(message: lastException) }
    if raw.isObject, raw.objectForKeyedSubscript("then")?.isObject == true { return raw }
    let encoded = stringify.call(withArguments: [raw])!
    if let lastException { throw ScriptError(message: lastException) }
    return encoded
  }
}
