import Foundation

struct SeededRandom: RandomNumberGenerator {
  private var state: UInt64

  init(seed: UInt64) {
    state = seed
  }

  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var mixed = state
    mixed = (mixed ^ (mixed >> 30)) &* 0xBF58_476D_1CE4_E5B9
    mixed = (mixed ^ (mixed >> 27)) &* 0x94D0_49BB_1331_11EB
    return mixed ^ (mixed >> 31)
  }

  mutating func chance(_ probability: Double) -> Bool {
    probability >= 1 || (probability > 0 && Double.random(in: 0..<1, using: &self) < probability)
  }
}

final class FakeICloud {
  struct Entry {
    var isDirectory: Bool
    var isPlaceholder: Bool
  }

  let macFolder: URL
  let phoneFolder: URL
  private(set) var deletionsDelivered = 0
  private var synced: Set<String> = []
  private var random: SeededRandom
  private let fileManager = FileManager.default

  init(root: URL, seed: UInt64 = 1) throws {
    macFolder = root.appendingPathComponent("Mac/Ardia Sync", isDirectory: true)
    phoneFolder = root.appendingPathComponent("Phone/Ardia Sync", isDirectory: true)
    random = SeededRandom(seed: seed)
    try fileManager.createDirectory(at: macFolder, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: phoneFolder, withIntermediateDirectories: true)
  }

  var hasUndelivered: Bool {
    let mac = entries(macFolder)
    let phone = entries(phoneFolder)
    return Set(mac.keys) != Set(phone.keys) || mac.contains { $0.value.isPlaceholder } || phone.contains { $0.value.isPlaceholder }
  }

  func deliverEverything() {
    for _ in 0..<4 where hasUndelivered { deliver() }
  }

  func deliver(chance: Double = 1, asPlaceholders placeholderChance: Double = 0) {
    let mac = entries(macFolder)
    let phone = entries(phoneFolder)
    let everywhere = Set(mac.keys).union(phone.keys)
    var next = synced.intersection(everywhere)
    for path in everywhere.sorted() {
      switch (mac[path], phone[path]) {
      case (let entry?, nil):
        guard random.chance(chance) else { continue }
        if synced.contains(path) {
          remove(path, in: macFolder)
          deletionsDelivered += 1
          next.remove(path)
        } else {
          copy(path, entry, from: macFolder, to: phoneFolder, placeholder: random.chance(placeholderChance))
          next.insert(path)
        }
      case (nil, let entry?):
        guard random.chance(chance) else { continue }
        if synced.contains(path) {
          remove(path, in: phoneFolder)
          deletionsDelivered += 1
          next.remove(path)
        } else {
          copy(path, entry, from: phoneFolder, to: macFolder, placeholder: random.chance(placeholderChance))
          next.insert(path)
        }
      case (let onMac?, let onPhone?):
        next.insert(path)
        guard onMac.isPlaceholder != onPhone.isPlaceholder, random.chance(chance) else { continue }
        let (source, target) = onMac.isPlaceholder ? (phoneFolder, macFolder) : (macFolder, phoneFolder)
        try? fileManager.removeItem(at: placeholderURL(path, in: target))
        copy(path, Entry(isDirectory: false, isPlaceholder: false), from: source, to: target, placeholder: false)
      case (nil, nil):
        continue
      }
    }
    synced = next
  }

  func makeConflictCopies(in relativeDirectory: String) throws {
    for folder in [macFolder, phoneFolder] {
      let directory = folder.appendingPathComponent(relativeDirectory, isDirectory: true)
      let names = try fileManager.contentsOfDirectory(atPath: directory.path).filter { !$0.hasPrefix(".") }
      for name in names {
        let url = directory.appendingPathComponent(name)
        let copy = directory.appendingPathComponent("\(url.deletingPathExtension().lastPathComponent) 2.\(url.pathExtension)")
        try? fileManager.copyItem(at: url, to: copy)
      }
      try Data().write(to: directory.appendingPathComponent(".DS_Store"))
      try Data("bplist00".utf8).write(to: directory.appendingPathComponent(".notes 2.txt.icloud"))
    }
  }

  func entries(_ folder: URL) -> [String: Entry] {
    var result: [String: Entry] = [:]
    for path in fileManager.subpaths(atPath: folder.path) ?? [] {
      var isDirectory: ObjCBool = false
      guard fileManager.fileExists(atPath: folder.appendingPathComponent(path).path, isDirectory: &isDirectory) else { continue }
      let name = (path as NSString).lastPathComponent
      let parent = (path as NSString).deletingLastPathComponent
      if !isDirectory.boolValue, name.hasPrefix("."), name.hasSuffix(".icloud") {
        let real = String(name.dropFirst().dropLast(".icloud".count))
        result[parent.isEmpty ? real : "\(parent)/\(real)"] = Entry(isDirectory: false, isPlaceholder: true)
      } else {
        result[path] = Entry(isDirectory: isDirectory.boolValue, isPlaceholder: false)
      }
    }
    return result
  }

  private func placeholderURL(_ path: String, in folder: URL) -> URL {
    let url = folder.appendingPathComponent(path)
    return url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
  }

  private func copy(_ path: String, _ entry: Entry, from source: URL, to target: URL, placeholder: Bool) {
    let destination = target.appendingPathComponent(path)
    try? fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    if entry.isDirectory {
      try? fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
    } else if placeholder || entry.isPlaceholder {
      try? Data("bplist00".utf8).write(to: placeholderURL(path, in: target))
    } else if let data = try? Data(contentsOf: source.appendingPathComponent(path)) {
      try? data.write(to: destination, options: .atomic)
    }
  }

  private func remove(_ path: String, in folder: URL) {
    try? fileManager.removeItem(at: folder.appendingPathComponent(path))
    try? fileManager.removeItem(at: placeholderURL(path, in: folder))
  }
}
