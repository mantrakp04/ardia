import ExpoModulesCore

final class CallArgs {
  let profile: String
  let json: String

  init(profile: String, json: String) {
    self.profile = profile
    self.json = json
  }

  lazy var values: [String: Any] = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]

  func string(_ key: String) -> String? { values[key] as? String }
  func text(_ key: String) -> String { string(key) ?? "" }
  func bool(_ key: String) -> Bool? { (values[key] as? NSNumber)?.boolValue }
  func double(_ key: String) -> Double? { (values[key] as? NSNumber)?.doubleValue }
  func int(_ key: String) -> Int? { (values[key] as? NSNumber)?.intValue }
  func dict(_ key: String) -> [String: Any]? { values[key] as? [String: Any] }
  func list(_ key: String) -> [Any] { values[key] as? [Any] ?? [] }
  func strings(_ key: String) -> [String] { values[key] as? [String] ?? [] }
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

typealias CallHandler = (CallArgs, CallReply) -> Void

struct CallTable {
  let domain: String
  let handlers: [String: CallHandler]

  func run(_ name: String, _ profile: String, _ args: String, _ promise: Promise) {
    guard let handler = handlers[name] else { return promise.reject("ERR_UNKNOWN_CALL", "\(domain).\(name) isn't a call") }
    handler(CallArgs(profile: profile, json: args), CallReply(promise: promise))
  }
}

enum EngineCall {
  static func passing(_ name: String) -> CallHandler {
    { args, reply in
      ArdiaEngineBridge.call(name, profile: args.profile, args: args.json) { reply.engine($0) }
    }
  }

  static func listen(_ domain: String, _ module: Module) {
    ArdiaEvents.setSender({ [weak module] name, data in module?.sendEvent(domain, ["name": name, "data": data]) }, forDomain: domain)
  }
}
