import ArdiaShared
@preconcurrency import ArdiaSyncCore
import Foundation

final class SyncHost {
  let files: SyncFiles
  let keys: SyncKeys
  let vault: SyncVault
  let grant: SyncFolderGrant
  var journal = SyncJournal()

  init(files: SyncFiles, keys: SyncKeys, vault: SyncVault, grant: SyncFolderGrant) {
    self.files = files
    self.keys = keys
    self.vault = vault
    self.grant = grant
  }

  struct HostError: Error, CustomStringConvertible {
    let description: String
  }

  private struct Listing: Encodable {
    struct File: Encodable {
      var id: String
      var payload: String
    }

    struct Damaged: Encodable {
      var id: String
      var age: Double
    }

    var files: [File]
    var pending: [String]
    var damaged: [Damaged]
    var present: [String]
  }

  func register(on script: ScriptEngine) {
    script.register("chainStatus") { [unowned self] _ in chainStatus() }
    script.register("read") { [unowned self] arguments in
      try read(scope: argument(arguments, 0), known: decode([String].self, argument(arguments, 1)))
    }
    script.register("write") { [unowned self] arguments in
      try vault.write(scope: argument(arguments, 0), payload: Data(argument(arguments, 1).utf8))
    }
    script.register("remove") { [unowned self] arguments in
      vault.remove(scope: try argument(arguments, 0), ids: try decode([String].self, argument(arguments, 1)))
      return ""
    }
    script.register("persistJournal") { [unowned self] arguments in
      try persistJournal(scope: argument(arguments, 0), batches: decode([String].self, argument(arguments, 1)))
    }
    script.register("saveState") { [unowned self] arguments in
      try saveState(argument(arguments, 0), seqs: decode([String: Int].self, argument(arguments, 1)))
    }
  }

  func chainStatus() -> String {
    let folder = vault.folder
    guard SyncFolderAccess.isDirectory(folder) else { return "unavailable" }
    var exists = vault.chainExists()
    if !exists {
      _ = SyncFolderAccess.coordinatedListing(folder)
      exists = vault.chainExists()
    }
    return exists ? "ok" : "missing"
  }

  private func read(scope: String, known: [String]) throws -> String {
    _ = SyncFolderAccess.coordinatedListing(vault.chainURL.appendingPathComponent(keys.scopeTag(scope), isDirectory: true))
    return try Self.listingJSON(vault.read(scope: scope, skipping: Set(known)))
  }

  static func listingJSON(_ listing: SyncVault.Listing) throws -> String {
    let encoded = Listing(
      files: listing.files.map { .init(id: $0.id, payload: String(decoding: $0.payload, as: UTF8.self)) },
      pending: listing.pending,
      damaged: listing.damaged.map { .init(id: $0.id, age: $0.age * 1000) },
      present: listing.present
    )
    return String(decoding: try JSONEncoder().encode(encoded), as: UTF8.self)
  }

  private func persistJournal(scope: String, batches: [String]) throws -> String {
    var next = journal
    try next.add(scope: scope, batches: batches)
    try files.writeSealed(JSONEncoder().encode(next), to: files.journalURL, keys: keys, fileId: SyncFiles.journalFile)
    journal = next
    return "ok"
  }

  private func saveState(_ state: String, seqs: [String: Int]) throws -> String {
    do {
      try files.writeSealed(Data(state.utf8), to: files.stateURL, keys: keys, fileId: SyncFiles.stateFile)
    } catch {
      return "failed"
    }
    var next = journal
    next.prune(saved: seqs)
    if next != journal {
      if next.entries.isEmpty {
        try? FileManager.default.removeItem(at: files.journalURL)
      } else {
        try? files.writeSealed(JSONEncoder().encode(next), to: files.journalURL, keys: keys, fileId: SyncFiles.journalFile)
      }
      journal = next
    }
    return "ok"
  }

  private func argument(_ arguments: [String], _ index: Int) throws -> String {
    guard arguments.indices.contains(index) else { throw HostError(description: "missing argument \(index)") }
    return arguments[index]
  }

  private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
  }
}
