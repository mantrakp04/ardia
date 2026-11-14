import ArdiaShared
import ArdiaSync
import ArdiaSyncCore
import Foundation
import Testing

final class TestMac {
  static let macDevice = "macbookpro0000000000000000"
  let device: String
  let vault: SyncVault
  let keys: SyncKeys
  private let script: ScriptEngine

  private struct Listing: Encodable {
    struct File: Encodable {
      let id: String
      let payload: String
    }

    struct Damaged: Encodable {
      let id: String
      let age: Double
    }

    let files: [File]
    let pending: [String]
    let damaged: [Damaged]
    let present: [String]
  }

  static let source = """
  (() => {
    const S = globalThis.ArdiaSync;
    const scopes = {};
    const stores = {};
    let clock = null;
    const now = () => Date.now();
    const transport = {
      read: async (scope, known) => JSON.parse(__host.read(scope, JSON.stringify(known))),
      write: async (scope, payload) => __host.write(scope, payload),
      remove: async (scope, ids) => { __host.remove(scope, JSON.stringify(ids)); },
    };
    const adapter = (scope) => {
      const store = (stores[scope] ??= {});
      return {
        prefix: "",
        extract: () => ({ values: new Map(Object.entries(store)) }),
        apply: (view, changed) => {
          for (const key of changed) {
            if (view.has(key)) store[key] = view.get(key);
            else delete store[key];
          }
        },
      };
    };
    S.macPut = ({ scope, key, value }) => { (stores[scope] ??= {})[key] = value; return true; };
    S.macStore = ({ scope }) => stores[scope] ?? {};
    S.macSync = async ({ device, scopes: list }) => {
      clock ??= new S.Clock(device, undefined, now);
      for (const scope of list) {
        await S.syncScope({ scope, state: (scopes[scope] ??= S.emptyScope()), transport, adapters: [adapter(scope)], clock, device, now });
      }
      return true;
    };
  })();
  """

  init(folder: URL, entropy: Data, creating: Bool) throws {
    device = creating ? Self.macDevice : "inspectormac00000000000000"
    keys = SyncKeys(entropy: entropy)
    vault = SyncVault(folder: folder, keys: keys)
    if creating { try vault.createChain() }
    script = try ScriptEngine(scripts: [.sync], extra: [Self.source])
    let vault = vault
    script.register("read") { arguments in
      let listing = try vault.read(scope: arguments[0], skipping: Set(JSONDecoder().decode([String].self, from: Data(arguments[1].utf8))))
      let encoded = Listing(
        files: listing.files.map { .init(id: $0.id, payload: String(decoding: $0.payload, as: UTF8.self)) },
        pending: listing.pending,
        damaged: listing.damaged.map { .init(id: $0.id, age: $0.age * 1000) },
        present: listing.present
      )
      return String(decoding: try JSONEncoder().encode(encoded), as: UTF8.self)
    }
    script.register("write") { arguments in try vault.write(scope: arguments[0], payload: Data(arguments[1].utf8)) }
    script.register("remove") { arguments in
      try vault.remove(scope: arguments[0], ids: JSONDecoder().decode([String].self, from: Data(arguments[1].utf8)))
      return ""
    }
  }

  func put(_ scope: String, _ key: String, _ valueJSON: String) throws {
    _ = try script.call(.sync, "macPut", json: [#"{"scope":\#(json(scope)),"key":\#(json(key)),"value":\#(valueJSON)}"#])
  }

  func sync(_ scopes: [String]) throws {
    let list = String(decoding: try JSONEncoder().encode(scopes), as: UTF8.self)
    _ = try script.callAsync(.sync, "macSync", json: [#"{"device":\#(json(device)),"scopes":\#(list)}"#])
  }

  func store(_ scope: String) throws -> [String: Any] {
    let text = try script.call(.sync, "macStore", json: [#"{"scope":\#(json(scope))}"#])
    return try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] ?? [:]
  }

  private func json(_ string: String) -> String {
    String(decoding: (try? JSONEncoder().encode(string)) ?? Data("\"\"".utf8), as: UTF8.self)
  }
}

@Suite struct TestMacFolder {
  static let profile = "personal000000000000000000"
  static let work = "work000000000000000000000"
  static var target: URL? { ProcessInfo.processInfo.environment["PHONE_SYNC_TEST_MAC"].map { URL(filePath: $0, directoryHint: .isDirectory) } }

  @Test(.enabled(if: target != nil && ProcessInfo.processInfo.environment["PHONE_SYNC_TEST_MAC_MODE"] == "create"))
  func makeATestMacFolder() throws {
    let root = try #require(Self.target)
    let folder = root.appending(path: "Ardia Sync", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let entropy = RecoveryPhrase.generateEntropy()
    let mac = try TestMac(folder: folder, entropy: entropy, creating: true)
    try mac.put("app", "dev:\(mac.device)", #"{"n":"Test MacBook Pro","k":"mac","f":["send"]}"#)
    try mac.put("app", "prof:\(Self.profile)", #"{"n":"Personal","c":"blue","i":null,"d":true}"#)
    try mac.put("app", "prof:\(Self.work)", #"{"n":"Work","c":"orange","i":null,"d":false}"#)
    try mac.put("app", "set:searchEngine", #"{"v":"duckduckgo"}"#)
    try mac.put("p:\(Self.profile)", "tabs:\(mac.device)", #"{"n":"Test MacBook Pro","tabs":[{"u":"https://example.com/","t":"Example on the Mac"},{"u":"https://www.wikipedia.org/","t":"Wikipedia"}]}"#)
    try mac.put("p:\(Self.profile)", "pin:t:tile", #"{"g":null,"u":"https://calendar.example/","t":null,"i":null,"ti":"Calendar","pos":"1"}"#)
    try mac.put("p:\(Self.profile)", "bm:docs", #"{"k":"u","p":"bar","t":"Docs","u":"https://docs.example/","a":2,"pos":"1"}"#)
    try mac.put("p:\(Self.work)", "tabs:\(mac.device)", #"{"n":"Test MacBook Pro","tabs":[{"u":"https://work.example/","t":"Work tab"}]}"#)
    try mac.sync(["app", "p:\(Self.profile)", "p:\(Self.work)"])
    try RecoveryPhrase.words(for: entropy).joined(separator: " ").write(to: root.appending(path: "phrase.txt"), atomically: true, encoding: .utf8)
    try entropy.base64EncodedString().write(to: root.appending(path: "entropy.txt"), atomically: true, encoding: .utf8)
  }

  @Test(.enabled(if: target != nil && ProcessInfo.processInfo.environment["PHONE_SYNC_TEST_MAC_MODE"] == "inspect"))
  func inspectATestMacFolder() throws {
    let root = try #require(Self.target)
    let entropy = try #require(Data(base64Encoded: String(contentsOf: root.appending(path: "entropy.txt"), encoding: .utf8)))
    let mac = try TestMac(folder: root.appending(path: "Ardia Sync", directoryHint: .isDirectory), entropy: entropy, creating: false)
    let scopes = ["app", "p:\(Self.profile)", "p:\(Self.work)"]
    try mac.sync(scopes)
    var report: [String: Any] = [:]
    let app = try mac.store("app")
    report["devices"] = app.filter { $0.key.hasPrefix("dev:") }.mapValues { ($0 as? [String: Any])?["n"] ?? "" }
    for scope in scopes.dropFirst() {
      let store = try mac.store(scope)
      report[scope] = store.filter { $0.key.hasPrefix("tabs:") && $0.key != "tabs:\(TestMac.macDevice)" }.mapValues { value in
        ((value as? [String: Any])?["tabs"] as? [[String: Any]])?.compactMap { $0["u"] as? String } ?? []
      }
      report["\(scope) history"] = store.keys.filter { $0.hasPrefix("h:") }.sorted()
      report["\(scope) sent"] = store.filter { $0.key.hasPrefix("send:") }.compactMap { ($0.value as? [String: Any])?["u"] as? String }
    }
    let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: root.appending(path: "inspect.json"))
  }

  @Test(.enabled(if: target != nil && ProcessInfo.processInfo.environment["PHONE_SYNC_TEST_MAC_MODE"] == "send"))
  func sendATabToThePhone() throws {
    let root = try #require(Self.target)
    let entropy = try #require(Data(base64Encoded: String(contentsOf: root.appending(path: "entropy.txt"), encoding: .utf8)))
    let phone = try String(contentsOf: root.appending(path: "phone-id.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    let mac = try TestMac(folder: root.appending(path: "Ardia Sync", directoryHint: .isDirectory), entropy: entropy, creating: false)
    let scope = "p:\(Self.profile)"
    try mac.sync(["app", scope])
    let key = "send:\(UUID().uuidString.lowercased())"
    let at = Int(Date.now.timeIntervalSince1970 * 1000)
    try mac.put(scope, key, #"{"u":"https://sent-from-mac.example/","t":"Sent from the Mac","to":"\#(phone)","from":"\#(TestMac.macDevice)","at":\#(at)}"#)
    try mac.sync([scope])
  }
}
