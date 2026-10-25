import ArdiaShared
@preconcurrency import ArdiaSyncCore
import Foundation

final class SyncHost {
  let files: SyncFiles
  let keys: SyncKeys
  let coordination: SyncCoordination
  private(set) var vault: SyncVault
  private(set) var grant: SyncFolderGrant
  var journal = SyncJournal()
  var timedOut = false
  var chainSeen = false
  let device: String

  init(device: String, files: SyncFiles, keys: SyncKeys, grant: SyncFolderGrant, coordination: SyncCoordination) {
    self.device = device
    self.files = files
    self.keys = keys
    self.coordination = coordination
    self.grant = grant
    vault = Self.vault(grant.folder, keys: keys, coordination: coordination)
  }

  func use(_ grant: SyncFolderGrant) {
    self.grant = grant
    chainSeen = false
    vault = Self.vault(grant.folder, keys: keys, coordination: coordination)
  }

  private static func vault(_ folder: URL, keys: SyncKeys, coordination: SyncCoordination) -> SyncVault {
    let vault = SyncVault(folder: folder, keys: keys)
    vault.coordination = coordination
    return vault
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
      try timing { try vault.write(scope: argument(arguments, 0), payload: Data(argument(arguments, 1).utf8)) }
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
    guard let names = SyncFolderAccess.coordinatedListing(vault.folder, coordination: coordination) else {
      timedOut = true
      return "unavailable"
    }
    if names.contains(vault.chainURL.lastPathComponent) {
      chainSeen = true
      return "ok"
    }
    return chainSeen || names.contains(where: { $0 != ".DS_Store" }) ? "missing" : "unavailable"
  }

  private func read(scope: String, known: [String]) throws -> String {
    let folder = vault.chainURL.appendingPathComponent(keys.scopeTag(scope), isDirectory: true)
    if SyncFolderAccess.isDirectory(folder), SyncFolderAccess.coordinatedListing(folder, coordination: coordination) == nil {
      timedOut = true
      throw SyncCoordination.TimedOut()
    }
    let listing = vault.read(scope: scope, skipping: Set(known))
    if listing.timedOut {
      timedOut = true
      throw SyncCoordination.TimedOut()
    }
    return try Self.listingJSON(listing)
  }

  private func timing<T>(_ body: () throws -> T) throws -> T {
    do {
      return try body()
    } catch let error as SyncCoordination.TimedOut {
      timedOut = true
      throw error
    }
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
    files.clearFresh(for: device)
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
