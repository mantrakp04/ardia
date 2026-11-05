import ExpoModulesCore

struct BadCallArgs: Error {
  let message: String
}

final class CallArgs {
  let profile: String
  let json: String
  let values: [String: Any]

  init(profile: String, json: String) throws {
    guard let values = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else {
      throw BadCallArgs(message: "the arguments aren't a JSON object")
    }
    self.profile = profile
    self.json = json
    self.values = values
  }

  private func optional<T>(_ key: String, _ kind: String) throws -> T? {
    guard let raw = values[key], !(raw is NSNull) else { return nil }
    guard let value = raw as? T else { throw BadCallArgs(message: "\(key) isn't \(kind)") }
    return value
  }

  private func required<T>(_ key: String, _ kind: String) throws -> T {
    guard let value: T = try optional(key, kind) else { throw BadCallArgs(message: "\(key) is missing") }
    return value
  }

  func text(_ key: String) throws -> String { try required(key, "a string") }
  func optionalText(_ key: String) throws -> String? { try optional(key, "a string") }
  func bool(_ key: String) throws -> Bool { try required(key, "a boolean") }
  func optionalBool(_ key: String) throws -> Bool? { try optional(key, "a boolean") }
  func double(_ key: String) throws -> Double { try required(key, "a number") }
  func optionalDouble(_ key: String) throws -> Double? { try optional(key, "a number") }
  func int(_ key: String) throws -> Int { try required(key, "an integer") }
  func int32(_ key: String) throws -> Int32 { Int32(try int(key)) }
  func dict(_ key: String) throws -> [String: Any] { try required(key, "an object") }
  func dicts(_ key: String) throws -> [[String: Any]] { try required(key, "a list of objects") }
  func strings(_ key: String) throws -> [String] { try required(key, "a list of strings") }

  func choice<Choice: RawRepresentable>(_ key: String, _: Choice.Type = Choice.self) throws -> Choice where Choice.RawValue == String {
    let raw = try text(key)
    guard let value = Choice(rawValue: raw) else { throw BadCallArgs(message: "\(key) isn't one of the values it takes") }
    return value
  }
}

struct CallReply {
  let promise: Promise

  func ok(_ value: Any? = nil) {
    var reply = value ?? NSNull()
    if !JSONSerialization.isValidJSONObject([reply]) { reply = Self.finite(reply) }
    guard JSONSerialization.isValidJSONObject([reply]),
      let data = try? JSONSerialization.data(withJSONObject: reply, options: [.fragmentsAllowed]),
      let json = String(data: data, encoding: .utf8)
    else { return fail("ERR_BAD_REPLY", "the reply isn't JSON") }
    promise.resolve(json)
  }

  func engine(_ json: String) {
    if let message = Self.engineError(json) { return fail("ERR_ENGINE", message) }
    promise.resolve(json)
  }

  func service(_ value: Any?, _ error: String?) {
    if let error { return fail("ERR_ENGINE", error) }
    ok(value)
  }

  func fail(_ code: String, _ message: String) { promise.reject(code, message) }

  static func finite(_ value: Any) -> Any {
    if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), !number.doubleValue.isFinite { return NSNull() }
    if let dict = value as? [String: Any] { return dict.mapValues(finite) }
    if let list = value as? [Any] { return list.map(finite) }
    return value
  }

  static func engineError(_ json: String) -> String? {
    guard json.contains("\"error\"") else { return nil }
    guard let reply = try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed]) else { return "the engine's reply isn't JSON" }
    guard let dict = reply as? [String: Any], let error = dict["error"] else { return nil }
    return error as? String ?? "\(error)"
  }
}

typealias CallHandler = (CallArgs, CallReply) throws -> Void

struct CallTable {
  let domain: String
  let handlers: [String: CallHandler]

  var moduleName: String { "Ardia\(domain.prefix(1).uppercased())\(domain.dropFirst())" }

  var function: AnyDefinition {
    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  func forwardEvents(to module: Module) -> AnyDefinition {
    OnCreate { [domain, weak module] in
      ArdiaEvents.setSender({ [weak module] name, data in module?.sendEvent(domain, ["name": name, "data": data]) }, forDomain: domain)
    }
  }

  func run(_ name: String, _ profile: String, _ args: String, _ promise: Promise) {
    guard let handler = handlers[name] else { return promise.reject("ERR_UNKNOWN_CALL", "\(domain).\(name) isn't a call") }
    do {
      try handler(try CallArgs(profile: profile, json: args), CallReply(promise: promise))
    } catch let error as BadCallArgs {
      promise.reject("ERR_BAD_ARGS", "\(domain).\(name): \(error.message)")
    } catch {
      promise.reject("ERR_BAD_ARGS", "\(domain).\(name): \(error.localizedDescription)")
    }
  }
}

enum EngineCall {
  static func passing(_ name: String) -> CallHandler {
    { args, reply in
      ArdiaEngineBridge.call(name, profile: args.profile, args: args.json) { reply.engine($0) }
    }
  }

  static func passing(_ name: String, profile: String, args: [String: Any], reply: CallReply) {
    guard let data = try? JSONSerialization.data(withJSONObject: args), let json = String(data: data, encoding: .utf8) else {
      return reply.fail("ERR_BAD_ARGS", "\(name): the arguments aren't JSON")
    }
    ArdiaEngineBridge.call(name, profile: profile, args: json) { reply.engine($0) }
  }

}
