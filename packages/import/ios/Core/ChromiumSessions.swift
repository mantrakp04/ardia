import Foundation

public enum ChromiumSessions {
  enum Command: UInt8 {
    case setTabWindow = 0
    case setTabIndexInWindow = 2
    case prunedFromBack = 5
    case updateTabNavigation = 6
    case setSelectedNavigationIndex = 7
    case setSelectedTabInIndex = 8
    case setWindowType = 9
    case prunedFromFront = 11
    case setPinnedState = 12
    case tabClosed = 16
    case windowClosed = 17
    case lastActiveTime = 21
    case pruned = 24
    case setTabGroup = 25
    case setTabGroupMetadata2 = 27
  }

  static let signature: UInt32 = 0x5353_4E53
  static let markerCommand: UInt8 = 255
  static let groupColors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]

  struct SessionFile {
    var url: URL
    var encrypted: Bool
  }

  static func sessionFiles(profile: URL) -> [SessionFile] {
    let fm = FileManager.default
    var candidates: [(stamp: Int64, file: SessionFile)] = []
    for (dir, encrypted) in [("Sessions", false), ("Sessions_Encrypted", true)] {
      let folder = profile.appendingPathComponent(dir)
      for name in (try? fm.contentsOfDirectory(atPath: folder.path)) ?? [] where name.hasPrefix("Session_") {
        if let stamp = Int64(name.dropFirst("Session_".count)) {
          candidates.append((stamp, SessionFile(url: folder.appendingPathComponent(name), encrypted: encrypted)))
        }
      }
    }
    if !candidates.isEmpty {
      return candidates.sorted { ($0.stamp, $0.file.encrypted ? 0 : 1) > ($1.stamp, $1.file.encrypted ? 0 : 1) }.map(\.file)
    }
    return ["Current Session", "Last Session"].map { profile.appendingPathComponent($0) }
      .filter { fm.fileExists(atPath: $0.path) }
      .map { SessionFile(url: $0, encrypted: false) }
  }

  public static func latestFile(profile: URL) -> URL? { sessionFiles(profile: profile).first?.url }

  public static func needsKey(profile: URL) -> Bool {
    let files = sessionFiles(profile: profile)
    guard files.contains(where: \.encrypted) else { return false }
    return !files.contains { !$0.encrypted && isComplete(cleartext: $0.url) }
  }

  static func isComplete(cleartext url: URL) -> Bool {
    guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return false }
    var reader = ByteReader(data)
    guard reader.u32() == signature, let version = reader.u32() else { return false }
    if version == 1 { return true }
    guard version == 3 else { return false }
    while let size = reader.u16(), size >= 1, let body = reader.bytes(Int(size)) {
      if size == 1, body[body.startIndex] == markerCommand { return true }
    }
    return false
  }

  public static func load(profile: URL, key: Data?) throws -> OpenTabs {
    let files = sessionFiles(profile: profile)
    guard !files.isEmpty else { throw ImportError.notFound("No session file in this profile") }
    var firstError: Error?
    for file in files where key != nil || !file.encrypted {
      do {
        return try parse(Data(contentsOf: file.url), key: key)
      } catch {
        firstError = firstError ?? error
      }
    }
    throw firstError ?? ImportError.locked("This session file is encrypted; unlock the browser first")
  }

  public static func parse(_ data: Data, key: Data?) throws -> OpenTabs {
    var reader = ByteReader(data)
    guard let sig = reader.u32(), sig == signature, let version = reader.u32() else {
      throw ImportError.unreadable("Not a Chromium session file")
    }
    var state = State()
    var sawMarker = false
    switch version {
    case 1, 3:
      while let size = reader.u16(), size >= 1, let body = reader.bytes(Int(size)) {
        let id = body[body.startIndex]
        if id == markerCommand, size == 1 { sawMarker = true }
        state.apply(id: id, payload: body.dropFirst())
      }
      guard version == 1 || sawMarker else { throw ImportError.unreadable("This session file is incomplete") }
    case 5:
      guard let key else { throw ImportError.locked("This session file is encrypted; unlock the browser first") }
      while let size = reader.u32(), let blob = reader.bytes(Int(size)) {
        guard let plain = ChromiumCrypto.decryptData(Data(blob), key: key), let id = plain.first else { break }
        if id == markerCommand, plain.count == 1 { sawMarker = true }
        state.apply(id: id, payload: plain.dropFirst())
      }
      guard sawMarker else { throw ImportError.locked("Couldn't decrypt the session file with this key") }
    default:
      throw ImportError.unsupported("Unsupported session file version \(version)")
    }
    return state.session()
  }

  struct Navigation {
    var index: Int32
    var url: String
    var title: String
  }

  struct TabState {
    var windowId: Int32 = 0
    var visualIndex: Int32 = 0
    var navigations: [Navigation] = []
    var currentNavigation: Int32 = 0
    var pinned = false
    var group: String?
    var lastActive: Double?

    func closest(_ index: Int32) -> Int {
      navigations.firstIndex { $0.index >= index } ?? navigations.endIndex
    }

    mutating func prune(from index: Int32, count: Int32) {
      if currentNavigation >= index && currentNavigation < index + count {
        currentNavigation = index - 1
      } else if currentNavigation >= index + count {
        currentNavigation -= count
      }
      navigations.removeSubrange(closest(index)..<max(closest(index), closest(index + count)))
      for i in navigations.indices where navigations[i].index >= index { navigations[i].index -= count }
    }
  }

  struct WindowState {
    var selectedTab: Int32 = 0
    var type: Int32?
  }

  struct State {
    var tabs: [Int32: TabState] = [:]
    var windows: [Int32: WindowState] = [:]
    var groups: [String: ImportedTabGroup] = [:]

    mutating func apply(id: UInt8, payload: Data) {
      let p = Data(payload)
      guard let command = Command(rawValue: id) else { return }
      var r = ByteReader(p)
      switch command {
      case .setTabWindow:
        guard let window = r.i32(), let tab = r.i32() else { return }
        tabs[tab, default: .init()].windowId = window
      case .setTabIndexInWindow:
        guard let tab = r.i32(), let index = r.i32() else { return }
        tabs[tab, default: .init()].visualIndex = index
      case .prunedFromBack:
        guard let tab = r.i32(), let index = r.i32() else { return }
        var t = tabs[tab, default: .init()]
        t.navigations.removeSubrange(t.closest(index)...)
        tabs[tab] = t
      case .prunedFromFront:
        guard let tab = r.i32(), let count = r.i32(), count > 0 else { return }
        tabs[tab, default: .init()].prune(from: 0, count: count)
      case .pruned:
        guard let tab = r.i32(), let index = r.i32(), let count = r.i32(), index >= 0, count > 0 else { return }
        tabs[tab, default: .init()].prune(from: index, count: count)
      case .updateTabNavigation:
        var pickle = Pickle(p)
        guard let tab = pickle.i32(), let index = pickle.i32(), let url = pickle.string(), let title = pickle.string16() else { return }
        var t = tabs[tab, default: .init()]
        let nav = Navigation(index: index, url: url, title: title)
        let i = t.closest(index)
        if i < t.navigations.endIndex, t.navigations[i].index == index { t.navigations[i] = nav } else { t.navigations.insert(nav, at: i) }
        tabs[tab] = t
      case .setSelectedNavigationIndex:
        guard let tab = r.i32(), let index = r.i32() else { return }
        tabs[tab, default: .init()].currentNavigation = index
      case .setSelectedTabInIndex:
        guard let window = r.i32(), let index = r.i32() else { return }
        windows[window, default: .init()].selectedTab = index
      case .setWindowType:
        guard let window = r.i32(), let type = r.i32() else { return }
        windows[window, default: .init()].type = type
      case .setPinnedState:
        guard let tab = r.i32(), let pinned = r.u8() else { return }
        tabs[tab, default: .init()].pinned = pinned != 0
      case .tabClosed, .windowClosed:
        guard let target = r.i32() else { return }
        if command == .tabClosed { tabs[target] = nil } else { windows[target] = nil }
      case .lastActiveTime:
        guard let tab = r.i32(), r.skip(4), let micros = r.i64() else { return }
        tabs[tab, default: .init()].lastActive = Time.fromWebKit(micros)
      case .setTabGroup:
        guard let tab = r.i32(), r.skip(4), let high = r.u64(), let low = r.u64(), let has = r.u8() else { return }
        tabs[tab, default: .init()].group = has != 0 ? ChromiumSessions.groupId(high, low) : nil
      case .setTabGroupMetadata2:
        var pickle = Pickle(p)
        guard let high = pickle.u64(), let low = pickle.u64(), let title = pickle.string16(), let color = pickle.u32() else { return }
        let collapsed = pickle.bool() ?? false
        let id = ChromiumSessions.groupId(high, low)
        let name = Int(color) < ChromiumSessions.groupColors.count ? ChromiumSessions.groupColors[Int(color)] : "grey"
        groups[id] = ImportedTabGroup(id: id, title: title, color: name, collapsed: collapsed)
      }
    }

    func session() -> OpenTabs {
      let windowIds = windows.filter { $0.value.type == 0 }.keys.sorted()
      var out: [ImportedTab] = []
      var usedGroups = Set<String>()
      for (windowIndex, windowId) in windowIds.enumerated() {
        let windowTabs = tabs.filter { $0.value.windowId == windowId && !$0.value.navigations.isEmpty }
          .sorted { ($0.value.visualIndex, $0.key) < ($1.value.visualIndex, $1.key) }
        let selected = Int(windows[windowId]?.selectedTab ?? 0)
        for (position, (_, tab)) in windowTabs.enumerated() {
          let i = tab.closest(tab.currentNavigation)
          let nav = i < tab.navigations.endIndex ? tab.navigations[i] : tab.navigations[tab.navigations.endIndex - 1]
          guard !nav.url.isEmpty else { continue }
          if let g = tab.group { usedGroups.insert(g) }
          out.append(ImportedTab(url: ChromiumSessions.withoutContainerPrefix(nav.url), title: nav.title, pinned: tab.pinned, groupId: tab.group,
                                 windowIndex: windowIndex, active: position == selected, lastActive: tab.lastActive))
        }
      }
      let groupList = usedGroups.sorted().map { id in
        groups[id] ?? ImportedTabGroup(id: id, title: "", color: "grey", collapsed: false)
      }
      return OpenTabs(tabs: out, groups: groupList)
    }
  }

  static func withoutContainerPrefix(_ url: String) -> String {
    guard url.hasPrefix("containers+"), let colon = url.firstIndex(of: ":") else { return url }
    let inner = url[url.index(after: colon)...]
    guard let scheme = inner.firstIndex(of: ":"), scheme > inner.startIndex else { return url }
    return String(inner)
  }

  static func groupId(_ high: UInt64, _ low: UInt64) -> String {
    String(format: "%016llX%016llX", high, low)
  }
}

struct ByteReader {
  let data: Data
  var offset: Int

  init(_ data: Data) {
    self.data = data
    offset = data.startIndex
  }

  var remaining: Int { data.endIndex - offset }

  mutating func bytes(_ n: Int) -> Data? {
    guard n >= 0, remaining >= n else { return nil }
    defer { offset += n }
    return data[offset..<offset + n]
  }

  mutating func skip(_ n: Int) -> Bool { bytes(n) != nil }

  private mutating func integer<T: FixedWidthInteger>(_: T.Type) -> T? {
    guard let b = bytes(MemoryLayout<T>.size) else { return nil }
    var v: T = 0
    for (i, byte) in b.enumerated() { v |= T(truncatingIfNeeded: byte) << (8 * i) }
    return v
  }

  mutating func u8() -> UInt8? { integer(UInt8.self) }
  mutating func u16() -> UInt16? { integer(UInt16.self) }
  mutating func u32() -> UInt32? { integer(UInt32.self) }
  mutating func i32() -> Int32? { integer(Int32.self) }
  mutating func u64() -> UInt64? { integer(UInt64.self) }
  mutating func i64() -> Int64? { integer(Int64.self) }
}

struct Pickle {
  var reader: ByteReader

  init(_ data: Data) {
    reader = ByteReader(data)
    _ = reader.u32()
  }

  private mutating func align() {
    let used = reader.offset - reader.data.startIndex
    let pad = (4 - used % 4) % 4
    _ = reader.skip(min(pad, reader.remaining))
  }

  mutating func i32() -> Int32? { reader.i32() }
  mutating func u32() -> UInt32? { reader.u32() }
  mutating func u64() -> UInt64? { reader.u64() }
  mutating func bool() -> Bool? { reader.i32().map { $0 != 0 } }

  mutating func string() -> String? {
    guard let n = reader.i32(), n >= 0, let b = reader.bytes(Int(n)) else { return nil }
    align()
    return String(decoding: b, as: UTF8.self)
  }

  mutating func string16() -> String? {
    guard let n = reader.i32(), n >= 0, let b = reader.bytes(Int(n) * 2) else { return nil }
    align()
    let units = stride(from: b.startIndex, to: b.endIndex, by: 2).map { UInt16(b[$0]) | UInt16(b[$0 + 1]) << 8 }
    return String(decoding: units, as: UTF16.self)
  }
}
