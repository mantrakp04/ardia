import ArdiaSyncCore
import Foundation

let password = "hunter2 \u{e9}\u{1F600}"
let scopes = ["app", "p:personal000000000000000000"]

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("crosscheck failed: \(message)\n".utf8))
  exit(1)
}

func payloads(for scope: String, device: String) -> [Data] {
  [
    Data("{\"kind\":\"log\",\"device\":\"\(device)\",\"scope\":\"\(scope)\",\"note\":\"caf\u{e9} \u{1F600}\"}".utf8),
    Data((0..<1020).map { UInt8($0 % 251) }),
    Data(),
  ]
}

func write(_ folder: URL) throws {
  try? FileManager.default.removeItem(at: folder)
  let entropy = RecoveryPhrase.generateEntropy()
  let keys = SyncKeys(entropy: entropy)
  let vault = SyncVault(folder: folder.appendingPathComponent("Ardia Sync", isDirectory: true), keys: keys)
  try vault.createChain()
  var lines = [
    "entropy\t\(entropy.base64EncodedString())",
    "phrase\t\(RecoveryPhrase.words(for: entropy).joined(separator: " "))",
    "chain\t\(keys.chainTag)",
    "scopes\t\(scopes.joined(separator: ","))",
    "password\t\(try keys.sealPassword(password, origin: "https://bank.example", username: "luke"))",
    "localState\t\(try keys.seal(Data("{\"device\":\"swift\"}".utf8), scopeTag: "local", fileId: "state").base64EncodedString())",
  ]
  for scope in scopes {
    let items = payloads(for: scope, device: "swift")
    for item in items { try vault.write(scope: scope, payload: item) }
    lines.append("scopeTag:\(scope)\t\(keys.scopeTag(scope))")
    lines.append("payloads:\(scope)\t\(items.map { $0.base64EncodedString() }.joined(separator: ","))")
  }
  try (lines.joined(separator: "\n") + "\n").write(to: folder.appendingPathComponent("manifest.txt"), atomically: true, encoding: .utf8)
  print("swift wrote \(scopes.count * 3) sealed files to \(folder.path)")
}

func read(_ folder: URL) throws {
  let text = try String(contentsOf: folder.appendingPathComponent("manifest.txt"), encoding: .utf8)
  var manifest: [String: String] = [:]
  for line in text.split(separator: "\n") {
    let parts = line.split(separator: "\t", maxSplits: 1).map(String.init)
    if parts.count == 2 { manifest[parts[0]] = parts[1] }
  }
  guard let entropy = manifest["entropy"].flatMap({ Data(base64Encoded: $0) }) else { fail("no entropy") }
  let keys = SyncKeys(entropy: entropy)
  guard keys.chainTag == manifest["chain"] else { fail("chain tag \(keys.chainTag) != \(manifest["chain"] ?? "")") }
  guard RecoveryPhrase.words(for: entropy).joined(separator: " ") == manifest["phrase"] else { fail("phrase") }
  guard try RecoveryPhrase.entropy(from: manifest["phrase"] ?? "") == entropy else { fail("phrase entropy") }
  let vault = SyncVault(folder: folder.appendingPathComponent("Ardia Sync", isDirectory: true), keys: keys)
  var opened = 0
  for scope in (manifest["scopes"] ?? "").split(separator: ",").map(String.init) {
    guard keys.scopeTag(scope) == manifest["scopeTag:\(scope)"] else { fail("scope tag for \(scope)") }
    let listing = try vault.read(scope: scope, skipping: [])
    guard listing.damaged.isEmpty, listing.pending.isEmpty else { fail("\(listing.damaged.count) damaged in \(scope)") }
    let got = listing.files.map { $0.payload.base64EncodedString() }.sorted()
    let want = (manifest["payloads:\(scope)"] ?? "").split(separator: ",", omittingEmptySubsequences: false).map(String.init).sorted()
    guard got == want else { fail("payloads in \(scope): \(got) != \(want)") }
    opened += got.count
  }
  guard let sealedPassword = manifest["password"] else { fail("no password") }
  guard try keys.openPassword(sealedPassword, origin: "https://bank.example", username: "luke") == password else { fail("password opens") }
  guard try keys.sealPassword(password, origin: "https://bank.example", username: "luke") == sealedPassword else { fail("password seals the same") }
  guard let local = manifest["localState"].flatMap({ Data(base64Encoded: $0) }),
        String(decoding: try keys.open(local, scopeTag: "local", fileId: "state"), as: UTF8.self) == "{\"device\":\"kotlin\"}"
  else { fail("local state") }
  print("swift opened \(opened) sealed files Kotlin wrote, the password and the local state, and matched the chain, scope tags and phrase")
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else { fail("usage: crosscheck write|read <folder>") }
let folder = URL(fileURLWithPath: arguments[2], isDirectory: true)
switch arguments[1] {
case "write": try write(folder)
case "read": try read(folder)
default: fail("usage: crosscheck write|read <folder>")
}
