import Foundation
import XCTest
@testable import ArdiaSyncCore

final class FakeDisk {
  var looked: [String] = []
  func disk(_ files: Set<String>, unknown: Set<String> = [], caseInsensitive: Bool = true) -> LegacyDockTile.Disk {
    let key = { (path: String) in caseInsensitive ? path.lowercased() : path }
    let known = Set(files.map(key)), hidden = Set(unknown.map(key))
    return LegacyDockTile.Disk(
      identity: { path in
        self.looked.append(path)
        if hidden.contains(key(path)) { return .unknown }
        return known.contains(key(path)) ? .file(key(path)) : .absent
      },
      caseInsensitive: caseInsensitive)
  }
}

func fakeDisk(_ files: Set<String>, unknown: Set<String> = [], caseInsensitive: Bool = true) -> LegacyDockTile.Disk {
  FakeDisk().disk(files, unknown: unknown, caseInsensitive: caseInsensitive)
}

final class LegacyDockTileTests: XCTestCase {
  let app = URL(fileURLWithPath: "/Applications/Ardia.app", isDirectory: true)
  let bundleId = "com.ardia.browser"
  let oldURL = "file:///Applications/\(LegacyName.appFileName)/"
  let oldAppPath = "/Applications/\(LegacyName.appFileName)"

  func tile(_ id: String, _ url: String, label: String, guid: Int = 1) -> [String: Any] {
    [
      "GUID": guid,
      "tile-type": "file-tile",
      "tile-data": [
        "book": Data([0x62, 0x6f, 0x6f, 0x6b]),
        "bundle-identifier": id,
        "dock-extra": 1,
        "file-data": ["_CFURLString": url, "_CFURLStringType": 15],
        "file-label": label,
        "file-mod-date": 200720580963911,
        "file-type": 41,
        "is-beta": 0,
        "parent-mod-date": 205938966538965,
      ] as [String: Any],
    ]
  }

  var messages: [String: Any] { tile("com.apple.MobileSMS", "file:///System/Applications/Messages.app/", label: "Messages", guid: 10) }
  var dia: [String: Any] { tile("company.thebrowser.dia", "file:///Applications/Dia.app/", label: "Dia", guid: 11) }
  var oldTile: [String: Any] { tile(LegacyName.bundleId, oldURL, label: LegacyName.appName, guid: 12) }
  var ardiaTile: [String: Any] { tile(bundleId, "file:///Applications/Ardia.app/", label: "Ardia", guid: 13) }

  func repoint(_ tiles: [[String: Any]], disk: LegacyDockTile.Disk? = nil) -> LegacyDockTile.Result {
    LegacyDockTile.repointed(tiles, app: app, bundleId: bundleId, label: "Ardia", disk: disk ?? fakeDisk(["/Applications/Ardia.app"]))
  }

  func data(_ tile: [String: Any]) -> [String: Any] { tile["tile-data"] as! [String: Any] }
  func ids(_ tiles: [[String: Any]]?) -> [String]? { tiles?.map { data($0)["bundle-identifier"] as! String } }
  func with(_ tile: [String: Any], _ change: (inout [String: Any]) -> Void) -> [String: Any] {
    var tile = tile, fields = data(tile)
    change(&fields)
    tile["tile-data"] = fields
    return tile
  }

  func testTheOldTileIsRewrittenInPlace() throws {
    let result = repoint([messages, oldTile, dia])
    let tiles = try XCTUnwrap(result.tiles)
    XCTAssertFalse(result.keptLive)
    XCTAssertEqual(ids(tiles), ["com.apple.MobileSMS", bundleId, "company.thebrowser.dia"])
    let rewritten = tiles[1], fields = data(rewritten)
    XCTAssertEqual(fields["file-label"] as? String, "Ardia")
    XCTAssertEqual(fields["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
    for key in ["book", "file-mod-date", "parent-mod-date"] { XCTAssertNil(fields[key], key) }
    XCTAssertEqual(rewritten["GUID"] as? Int, 12)
    XCTAssertEqual(rewritten["tile-type"] as? String, "file-tile")
    XCTAssertEqual(fields["file-type"] as? Int, 41)
    XCTAssertEqual(fields["dock-extra"] as? Int, 1)
    XCTAssertEqual(NSArray(array: [tiles[0], tiles[2]]), NSArray(array: [messages, dia]))
  }

  func testWhenArdiaIsPinnedTooTheOldTileGoes() throws {
    XCTAssertEqual(NSArray(array: try XCTUnwrap(repoint([oldTile, messages, ardiaTile]).tiles)), NSArray(array: [messages, ardiaTile]))
    let byFile = with(ardiaTile) {
      $0["bundle-identifier"] = "something.else"
      $0["file-data"] = ["_CFURLString": "file:///Applications/ARDIA.app", "_CFURLStringType": 15]
    }
    XCTAssertEqual(NSArray(array: try XCTUnwrap(repoint([oldTile, byFile]).tiles)), NSArray(array: [byFile]))
  }

  func testNoOldTileChangesNothing() {
    for tiles in [[messages, dia], [messages, ardiaTile], []] {
      let result = repoint(tiles)
      XCTAssertNil(result.tiles)
      XCTAssertFalse(result.keptLive)
    }
  }

  func testAnOldAppStillThereKeepsItsTileAndIsLookedAtAgain() {
    let result = repoint([messages, oldTile], disk: fakeDisk(["/Applications/Ardia.app", oldAppPath]))
    XCTAssertNil(result.tiles)
    XCTAssertTrue(result.keptLive)
    let byPath = with(oldTile) { $0["bundle-identifier"] = "" }
    let alone = repoint([byPath], disk: fakeDisk(["/Applications/Ardia.app", oldAppPath]))
    XCTAssertNil(alone.tiles)
    XCTAssertTrue(alone.keptLive)
    XCTAssertEqual(ids(repoint([byPath]).tiles), [bundleId])
  }

  func testADeadOldTileIsRepointedWhileALiveOneStays() throws {
    let live = tile(LegacyName.bundleId, "file:///Users/me/Old/\(LegacyName.appFileName)/", label: LegacyName.appName, guid: 20)
    let result = repoint([oldTile, live], disk: fakeDisk(["/Applications/Ardia.app", "/Users/me/Old/\(LegacyName.appFileName)"]))
    XCTAssertEqual(ids(result.tiles), [bundleId, LegacyName.bundleId])
    XCTAssertEqual(NSArray(array: [try XCTUnwrap(result.tiles)[1]]), NSArray(array: [live]))
    XCTAssertTrue(result.keptLive)
  }

  func testOldTilesAreFoundByIdOrByPath() throws {
    let elsewhere = tile(LegacyName.bundleId.uppercased(), "file:///Users/me/Downloads/\(LegacyName.appFileName)/", label: LegacyName.appName)
    XCTAssertEqual(ids(repoint([elsewhere]).tiles), [bundleId])
    let followed = tile(LegacyName.bundleId, "file:///Applications/Ardia.app/", label: LegacyName.appName)
    XCTAssertEqual(data(try XCTUnwrap(repoint([followed]).tiles)[0])["file-label"] as? String, "Ardia")
    let posix = with(oldTile) { $0["file-data"] = ["_CFURLString": self.oldAppPath, "_CFURLStringType": 0] }
    XCTAssertNil(repoint([posix], disk: fakeDisk(["/Applications/Ardia.app", oldAppPath])).tiles)
    XCTAssertEqual(ids(repoint([posix]).tiles), [bundleId])
    XCTAssertNil(repoint([tile("other.app", "file:///Users/me/\(LegacyName.appFileName)/", label: "x")]).tiles)
  }

  func testATileWithoutAFileURLIsLeftAlone() {
    let malformed: [[String: Any]] = [
      with(oldTile) { $0.removeValue(forKey: "file-data") },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "https://example.com/", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "relative/path", "_CFURLStringType": 0] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": oldURL] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "file:\(LegacyName.appFileName)/", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "file:Applications/\(LegacyName.appFileName)/", "_CFURLStringType": 15] },
      with(oldTile) { $0["file-data"] = ["_CFURLString": "file://server/Applications/\(LegacyName.appFileName)/", "_CFURLStringType": 15] },
      ["tile-type": "spacer-tile", "tile-data": [:] as [String: Any]],
    ]
    for tile in malformed {
      let result = repoint([tile])
      XCTAssertNil(result.tiles)
      XCTAssertFalse(result.keptLive)
    }
  }

  func testOnACaseSensitiveVolumeOnlyTheSameFileMatches() {
    let sensitive = fakeDisk(["/Applications/Ardia.app"], caseInsensitive: false)
    let lower = tile("", "file:///Applications/\(LegacyName.appFileName.lowercased())/", label: "x")
    XCTAssertNil(repoint([lower], disk: sensitive).tiles)
    XCTAssertEqual(ids(repoint([lower]).tiles), [bundleId])
    let other = tile("something.else", "file:///Applications/ardia.app/", label: "ardia")
    XCTAssertEqual(ids(repoint([oldTile, other], disk: sensitive).tiles), [bundleId, "something.else"])
    XCTAssertEqual(ids(repoint([oldTile, other]).tiles), ["something.else"])
  }

  func testAnOldAppThatCantBeLookedAtKeepsItsTile() {
    let result = repoint([messages, oldTile], disk: fakeDisk(["/Applications/Ardia.app"], unknown: [oldAppPath]))
    XCTAssertNil(result.tiles)
    XCTAssertTrue(result.keptLive)
  }

  func testOnlyTilesNamedLikeEitherAppAreLookedUp() {
    let disk = FakeDisk()
    let share = tile("", "file:///Volumes/Gone/Folder/", label: "Folder")
    _ = LegacyDockTile.repointed([messages, dia, share, oldTile, ardiaTile], app: app, bundleId: bundleId, label: "Ardia",
                                 disk: disk.disk(["/Applications/Ardia.app"]))
    XCTAssertFalse(disk.looked.contains { $0.hasPrefix("/Volumes") || $0.hasPrefix("/System") || $0.hasSuffix("Dia.app") }, "\(disk.looked)")
  }

  func testAFileURLOnThisMacMayNameLocalhost() {
    let localhost = with(oldTile) { $0["file-data"] = ["_CFURLString": "file://localhost/Applications/\(LegacyName.appFileName)/", "_CFURLStringType": 15] }
    XCTAssertEqual(ids(repoint([localhost]).tiles), [bundleId])
  }

  func testADeadArdiaTileIsntPinnedAndGoesLikeTheOldOne() throws {
    let downloads = "/Users/me/Downloads/Ardia.app"
    let deadArdia = tile(bundleId, "file://\(downloads)/", label: "Ardia", guid: 30)
    let result = try XCTUnwrap(repoint([oldTile, messages, deadArdia]).tiles)
    XCTAssertEqual(ids(result), [bundleId, "com.apple.MobileSMS"])
    XCTAssertEqual(result[0]["GUID"] as? Int, 12)
    XCTAssertEqual(data(result[0])["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
    let first = try XCTUnwrap(repoint([deadArdia, messages, oldTile]).tiles)
    XCTAssertEqual(ids(first), [bundleId, "com.apple.MobileSMS"])
    XCTAssertEqual(first[0]["GUID"] as? Int, 30)
    XCTAssertEqual(data(first[0])["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
    XCTAssertNil(repoint([deadArdia, messages]).tiles)
    XCTAssertEqual(ids(repoint([oldTile, deadArdia], disk: fakeDisk(["/Applications/Ardia.app", downloads])).tiles), [bundleId])
    XCTAssertEqual(data(try XCTUnwrap(repoint([oldTile, deadArdia], disk: fakeDisk(["/Applications/Ardia.app", downloads])).tiles)[0])["file-data"]
      as? [String: AnyHashable], ["_CFURLString": "file://\(downloads)/", "_CFURLStringType": 15])
    let unknown = try XCTUnwrap(repoint([oldTile, deadArdia], disk: fakeDisk(["/Applications/Ardia.app"], unknown: [downloads])).tiles)
    XCTAssertEqual(NSArray(array: [unknown[1]]), NSArray(array: [deadArdia]))
    XCTAssertEqual(data(unknown[0])["file-data"] as? [String: AnyHashable], ["_CFURLString": "file:///Applications/Ardia.app/", "_CFURLStringType": 15])
  }

  func testTwoDeadOldTilesBecomeOne() {
    let second = tile(LegacyName.bundleId, "file:///Users/me/Applications/\(LegacyName.appFileName)/", label: LegacyName.appName)
    XCTAssertEqual(ids(repoint([oldTile, messages, second]).tiles), [bundleId, "com.apple.MobileSMS"])
  }

  final class FakeDock {
    var tiles: [[String: Any]]?
    private var cached: [[String: Any]]?
    private var everSynchronized = false
    var writes = 0, restarts = 0, synchronizes = 0
    var events: [String] = []
    var looked: [String] = []
    var onSynchronize: ((Int) -> Void)?
    var writeWorks = true, restartWorks = true
    var flags: [String: Bool] = [:]
    var disk = fakeDisk(["/Applications/Ardia.app"])

    var seams: LegacyDockTile.Seams {
      let disk = self.disk
      return LegacyDockTile.Seams(
        synchronize: {
          self.synchronizes += 1
          self.onSynchronize?(self.synchronizes)
          self.events.append("sync")
          self.cached = self.tiles
          self.everSynchronized = true
        },
        read: {
          self.events.append("read")
          return self.everSynchronized ? self.cached : self.tiles
        },
        write: { tiles in
          self.writes += 1
          self.events.append("write")
          if self.writeWorks { self.tiles = tiles; self.cached = tiles }
          return self.writeWorks
        },
        restart: {
          self.restarts += 1
          self.events.append("restart")
          return self.restartWorks
        },
        flag: { self.flags[$0] ?? false },
        setFlag: {
          self.flags[$0] = $1 ? true : nil
          self.events.append("\($0)=\($1)")
        },
        disk: LegacyDockTile.Disk(identity: { path in
          self.events.append("stat")
          self.looked.append(path)
          return disk.identity(path)
        }, caseInsensitive: disk.caseInsensitive))
    }
    var done: Bool { flags[LegacyDockTile.doneKey] == true }
    var state: String { "writes \(writes), restarts \(restarts), done \(done)" }
  }

  func launch(_ dock: FakeDock) { LegacyDockTile.run(dock.seams, app: app, bundleId: bundleId) }

  func testALaunchRepointsRestartsAndIsDone() {
    let dock = FakeDock()
    dock.tiles = [messages, oldTile]
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
    XCTAssertEqual(ids(dock.tiles), ["com.apple.MobileSMS", bundleId])
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
  }

  func testNothingToDoIsDoneWithoutARestart() {
    let dock = FakeDock()
    dock.tiles = [messages, ardiaTile]
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done true")
  }

  func testAnUnreadableListOrAFailedWriteIsTriedAgain() {
    let dock = FakeDock()
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done false")
    dock.tiles = [oldTile]
    dock.writeWorks = false
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 0, done false")
    dock.writeWorks = true
    launch(dock)
    XCTAssertEqual(dock.state, "writes 2, restarts 1, done true")
  }

  func testAFailedRestartIsRetriedWithoutWritingAgain() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.restartWorks = false
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done false")
    XCTAssertEqual(dock.flags[LegacyDockTile.restartKey], true)
    dock.restartWorks = true
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 2, done true")
    XCTAssertNil(dock.flags[LegacyDockTile.restartKey])
  }

  func testAKeptOldTileIsLookedAtAgainWithoutRestarts() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.disk = fakeDisk(["/Applications/Ardia.app", oldAppPath])
    launch(dock)
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done false")
    dock.disk = fakeDisk(["/Applications/Ardia.app"])
    launch(dock)
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
  }

  func testTheRestartIsPendingBeforeTheListIsWritten() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    launch(dock)
    let steps = dock.events.filter { $0 != "stat" }
    XCTAssertEqual(steps, ["sync", "read", "\(LegacyDockTile.restartKey)=true", "sync", "read", "write", "restart",
                           "\(LegacyDockTile.restartKey)=false", "\(LegacyDockTile.doneKey)=true"])
    let section = dock.events.lastIndex(of: "sync")!
    XCTAssertEqual(Array(dock.events[section...].prefix(3)), ["sync", "read", "write"])
  }

  func testALaunchThatStoppedAfterWritingRestartsTheDockNext() {
    let dock = FakeDock()
    dock.tiles = repoint([oldTile]).tiles
    dock.flags[LegacyDockTile.restartKey] = true
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 1, done true")
    let early = FakeDock()
    early.tiles = [oldTile]
    early.flags[LegacyDockTile.restartKey] = true
    launch(early)
    XCTAssertEqual(early.state, "writes 1, restarts 1, done true")
  }

  func testAFailedWriteLeavesNoRestartPending() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.writeWorks = false
    launch(dock)
    XCTAssertNil(dock.flags[LegacyDockTile.restartKey])
    XCTAssertEqual(dock.state, "writes 1, restarts 0, done false")
  }

  func testTheListIsReadAgainRightBeforeTheWrite() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [self.messages, self.oldTile] } }
    launch(dock)
    XCTAssertEqual(ids(dock.tiles), ["com.apple.MobileSMS", bundleId])
    let fixed = FakeDock()
    fixed.tiles = [oldTile]
    fixed.onSynchronize = { if $0 == 2 { fixed.tiles = [self.ardiaTile] } }
    launch(fixed)
    XCTAssertEqual(fixed.state, "writes 0, restarts 0, done true")
    let gone = FakeDock()
    gone.tiles = [oldTile]
    gone.onSynchronize = { if $0 == 2 { gone.tiles = nil } }
    launch(gone)
    XCTAssertEqual(gone.state, "writes 0, restarts 0, done false")
  }

  func testATileThatWasntLookedUpStopsTheWrite() {
    let other = "/Users/me/Applications/Ardia.app"
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [self.oldTile, self.tile(self.bundleId, "file://\(other)/", label: "Ardia")] } }
    launch(dock)
    XCTAssertEqual(dock.state, "writes 0, restarts 0, done false")
    XCTAssertNil(dock.flags[LegacyDockTile.restartKey])
    dock.onSynchronize = nil
    dock.disk = fakeDisk(["/Applications/Ardia.app", other])
    launch(dock)
    XCTAssertEqual(dock.state, "writes 1, restarts 1, done true")
    XCTAssertEqual(ids(dock.tiles), [bundleId])
  }

  func testAStaleReadNeverOverwritesAPin() {
    let dock = FakeDock()
    dock.tiles = [oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [self.oldTile, self.messages] } }
    launch(dock)
    XCTAssertEqual(ids(dock.tiles), [bundleId, "com.apple.MobileSMS"])
  }

  func testAnUnrelatedAutomountTileIsNeverParsedOrLookedUp() {
    let automount = tile("", "file:///private/var/automount/Network/Servers/gone/Shared/../Folder/", label: "Folder")
    let posix = with(automount) { $0["file-data"] = ["_CFURLString": "/private/var/automount/Network/Servers/gone/Shared", "_CFURLStringType": 0] }
    let dock = FakeDock()
    dock.tiles = [automount, posix, oldTile]
    dock.onSynchronize = { if $0 == 2 { dock.tiles = [automount, posix, self.oldTile, self.messages] } }
    launch(dock)
    XCTAssertEqual(ids(dock.tiles), ["", "", bundleId, "com.apple.MobileSMS"])
    XCTAssertFalse(dock.looked.contains { $0.contains("automount") }, "\(dock.looked)")
    let section = dock.events.lastIndex(of: "sync")!
    XCTAssertFalse(dock.events[section...].contains("stat"))
  }

  func testPathsAreNormalizedByStringAlone() {
    XCTAssertEqual(LegacyDockTile.lexical("/Applications//Ardia.app/"), "/Applications/Ardia.app")
    XCTAssertEqual(LegacyDockTile.lexical("/Applications/./x/../Ardia.app"), "/Applications/Ardia.app")
    XCTAssertEqual(LegacyDockTile.lexical("/private/var/automount/Network/../x"), "/private/var/automount/x")
    XCTAssertEqual(LegacyDockTile.lexical("/../.."), "/")
    XCTAssertNil(LegacyDockTile.lexical("Applications/Ardia.app"))
    let encoded = with(oldTile) { $0["file-data"] = ["_CFURLString": "file:///Applications/\(LegacyName.appName)%2Eapp/", "_CFURLStringType": 15] }
    XCTAssertEqual(LegacyDockTile.rawName(data(encoded)), LegacyName.appFileName.lowercased())
    XCTAssertEqual(LegacyDockTile.filePath(data(encoded)), oldAppPath)
  }

  func testOnlyTheInstalledCopyQualifies() {
    let home = FileManager.default.homeDirectoryForCurrentUser
    XCTAssertTrue(LegacyDockTile.isInstalled(URL(fileURLWithPath: "/Applications/Ardia.app")))
    XCTAssertTrue(LegacyDockTile.isInstalled(home.appendingPathComponent("Applications/Ardia.app")))
    XCTAssertFalse(LegacyDockTile.isInstalled(URL(fileURLWithPath: oldAppPath)))
    XCTAssertFalse(LegacyDockTile.isInstalled(URL(fileURLWithPath: "/tmp/build/Ardia.app")))
    XCTAssertFalse(LegacyDockTile.isInstalled(home.appendingPathComponent("Library/Developer/Xcode/DerivedData/x/Ardia.app")))
    XCTAssertFalse(LegacyDockTile.isInstalled(URL(fileURLWithPath: "/private/var/folders/x/T/AppTranslocation/0000/d/Ardia.app")))
  }
}
