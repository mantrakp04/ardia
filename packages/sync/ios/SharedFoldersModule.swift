import AppKit
import ArdiaCore
import ExpoModulesCore

public class SharedFoldersModule: Module {
  private static let work = DispatchQueue(label: "ardia.shared-folders", qos: .utility)
  private var watcher: SharedFolderWatcher?

  public func definition() -> ModuleDefinition {
    Name("ArdiaSharedFolders")

    Events("onChange")

    OnCreate { [weak self] in
      self?.watcher = SharedFolderWatcher { [weak self] paths in self?.sendEvent("onChange", ["paths": paths]) }
    }

    Function("location") { () -> [String: Any] in
      [
        "path": Self.defaultParent.path,
        "iCloudAvailable": Self.testParent != nil || SyncFolder.iCloudDriveAvailable,
        "iCloudPath": SyncFolder.iCloudDrive.path,
      ]
    }

    AsyncFunction("read") { (path: String) -> [String: Any] in
      SharedFolderDirectory(root: URL(fileURLWithPath: path, isDirectory: true)).read()
    }.runOnQueue(Self.work)

    AsyncFunction("apply") { (path: String, ops: String) throws -> [String: Any] in
      try SharedFolderDirectory(root: URL(fileURLWithPath: path, isDirectory: true)).apply(json: ops)
    }.runOnQueue(Self.work)

    AsyncFunction("create") { (parent: String, name: String) throws -> String in
      try SharedFolderDirectory.create(in: URL(fileURLWithPath: parent, isDirectory: true), named: name).path
    }.runOnQueue(Self.work)

    Function("watch") { [weak self] (paths: [String]) in self?.watcher?.watch(paths) }

    OnDestroy { [weak self] in self?.watcher?.stop() }
  }

  private static let dataDirectory = LaunchConfig.shared.dataDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
  private static let testParent = LaunchConfig.shared.instance("sharedFolders").map { URL(fileURLWithPath: $0, isDirectory: true) }

  static var defaultParent: URL {
    if let testParent { return testParent }
    if let dataDirectory { return dataDirectory.appendingPathComponent("Ardia Shared", isDirectory: true) }
    return SyncFolder.iCloudDrive.appendingPathComponent("Ardia Shared", isDirectory: true)
  }
}
