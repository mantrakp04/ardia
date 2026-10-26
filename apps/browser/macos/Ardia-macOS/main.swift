import AppKit
import ArdiaCore
import ArdiaSync

let config = LaunchConfig.shared
if config.prewarm { exit(0) }

LegacyMigration.moveToNewName()

let scratch = config.dataDirectory.map {
  LegacyMigration.ScratchInstance(
    dataDirectory: $0, legacySource: config.testValue("legacySource"), crashAfter: config.testValue("legacyCrashAfter"))
}
if !LegacyMigration.runAtLaunch(scratch: scratch) { exit(0) }

exit(ArdiaHost.run(argc: CommandLine.argc, argv: CommandLine.unsafeArgv) { AppDelegate() })
