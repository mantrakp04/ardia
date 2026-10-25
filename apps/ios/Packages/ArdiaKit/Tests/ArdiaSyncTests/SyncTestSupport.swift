import ArdiaShared
import ArdiaSyncCore
import Foundation
@testable import ArdiaSync

final class Sandbox {
  let root: URL
  var folder: URL { root.appendingPathComponent("Ardia Sync", isDirectory: true) }
  var state: URL { root.appendingPathComponent("State", isDirectory: true) }
  var keys: URL { root.appendingPathComponent("Keys", isDirectory: true) }

  init() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent("ardia-sync-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  func remove() {
    try? FileManager.default.removeItem(at: root)
  }

  func contents(_ url: URL) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []).sorted()
  }
}

@MainActor
final class FakeSource: LocalBrowsingSource {
  var tabs: [LocalTabRecord] = []
  var visits: [LocalVisitRecord] = []
  var received: [ReceivedTab] = []
  var removed: [(urls: Set<String>, profile: String?)] = []
  var visitFetches: [Date] = []

  func syncedTabs() -> [LocalTabRecord] { tabs }
  func syncedVisits(since: Date) -> [LocalVisitRecord] {
    visitFetches.append(since)
    return visits.filter { $0.visitedAt.contains { $0 >= since } }
  }
  func removeVisits(urls: Set<String>, profileSyncId: String?) { removed.append((urls, profileSyncId)) }
  func receive(_ tabs: [ReceivedTab]) { received += tabs }
}

final class FakeMac {
  let device = "macbookpro0000000000000000"
  let vault: SyncVault
  let keys: SyncKeys
  private let script: ScriptEngine

  static let source = """
  (() => {
    const S = globalThis.ArdiaSync;
    const scopes = {};
    const stores = {};
    let clock = null;
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
    S.macDelete = ({ scope, key }) => { delete (stores[scope] ??= {})[key]; return true; };
    S.macStore = ({ scope }) => stores[scope] ?? {};
    S.macSync = async ({ device, scopes: list }) => {
      clock ??= new S.Clock(device);
      for (const scope of list) {
        await S.syncScope({ scope, state: (scopes[scope] ??= S.emptyScope()), transport, adapters: [adapter(scope)], clock, device });
      }
      return true;
    };
  })();
  """

  init(folder: URL, entropy: Data) throws {
    keys = SyncKeys(entropy: entropy)
    vault = SyncVault(folder: folder, keys: keys)
    try vault.createChain()
    script = try ScriptEngine(scripts: [.sync], extra: [Self.source])
    let vault = vault
    script.register("read") { arguments in
      try SyncHost.listingJSON(vault.read(scope: arguments[0], skipping: Set(JSONDecoder().decode([String].self, from: Data(arguments[1].utf8)))))
    }
    script.register("write") { arguments in try vault.write(scope: arguments[0], payload: Data(arguments[1].utf8)) }
    script.register("remove") { arguments in
      vault.remove(scope: arguments[0], ids: try JSONDecoder().decode([String].self, from: Data(arguments[1].utf8)))
      return ""
    }
  }

  func put(_ scope: String, _ key: String, _ valueJSON: String) throws {
    _ = try script.call(.sync, "macPut", json: [#"{"scope":\#(json(scope)),"key":\#(json(key)),"value":\#(valueJSON)}"#])
  }

  func delete(_ scope: String, _ key: String) throws {
    _ = try script.call(.sync, "macDelete", json: [#"{"scope":\#(json(scope)),"key":\#(json(key))}"#])
  }

  func sync(_ scopes: [String]) throws {
    let list = String(decoding: try JSONEncoder().encode(scopes), as: UTF8.self)
    _ = try script.callAsync(.sync, "macSync", json: [#"{"device":\#(json(device)),"scopes":\#(list)}"#])
  }

  func store(_ scope: String) throws -> [String: Any] {
    let text = try script.call(.sync, "macStore", json: [#"{"scope":\#(json(scope))}"#])
    return try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] ?? [:]
  }

  func scopeFolder(_ scope: String) -> URL {
    vault.chainURL.appendingPathComponent(keys.scopeTag(scope), isDirectory: true)
  }

  func logs(_ scope: String, device: String) -> [(seq: Int, json: String)] {
    vault.read(scope: scope, skipping: []).files.compactMap { file in
      guard let object = try? JSONSerialization.jsonObject(with: file.payload) as? [String: Any],
            object["kind"] as? String == "log", object["device"] as? String == device, let seq = object["seq"] as? Int
      else { return nil }
      return (seq, String(decoding: file.payload, as: UTF8.self))
    }
    .sorted { $0.seq < $1.seq }
  }

  private func json(_ string: String) -> String {
    String(decoding: (try? JSONEncoder().encode(string)) ?? Data("\"\"".utf8), as: UTF8.self)
  }
}

final class TestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var current = Date.now

  var now: Date { lock.withLock { current } }

  func advance(_ seconds: TimeInterval) {
    lock.withLock { current = current.addingTimeInterval(seconds) }
  }
}
