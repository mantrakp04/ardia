import XCTest
@testable import ArdiaUpdaterCore

final class ChannelSwitchTests: XCTestCase {
  typealias Copy = ChannelSwitch.Copy
  typealias Effect = ChannelSwitch.Effect
  let staged = Copy(folder: "/Installation/a", device: 1, inode: 10, build: "91")
  let restaged = Copy(folder: "/Installation/b", device: 1, inode: 11, build: "91")
  let newer = Copy(folder: "/Installation/c", device: 1, inode: 12, build: "92")
  let mayInstall = Effect.log("Sparkle didn't drop the staged nightly before the quit deadline; quitting, and it may install")
  let unreadableLine = Effect.log("Sparkle's cache can't be read to confirm the staged nightly is gone; quitting waits for its deadline")

  let unconfirmed: [Effect] = [.watch, .log("Sparkle's installer didn't confirm dropping the staged nightly; quitting waits for its deadline")]

  func facts(busy: Bool = false, _ copies: Set<Copy> = [], checks: Bool = true) -> ChannelSwitch.Facts {
    ChannelSwitch.Facts(busy: busy, staged: copies.isEmpty ? .none : .present(copies), automaticChecks: checks)
  }

  func unreadable(busy: Bool = false) -> ChannelSwitch.Facts {
    ChannelSwitch.Facts(busy: busy, staged: .unreadable, automaticChecks: true)
  }

  func quit(_ machine: inout ChannelSwitch, _ id: Int, _ facts: ChannelSwitch.Facts) -> [Effect] {
    machine.quit(id)
    return machine.changed(facts)
  }

  func seen(_ machine: inout ChannelSwitch, _ sighting: ChannelSwitch.Sighting, busy: Bool = false) -> ChannelSwitch.Staged {
    machine.observe(sighting, busy: busy, automaticChecks: true).staged
  }

  func cancelling(_ machine: inout ChannelSwitch) {
    XCTAssertEqual(machine.switched(), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91"), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
  }

  func testASwitchWithNothingStagedResetsTheUpdateCycle() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.switched(), [])
    XCTAssertEqual(machine.changed(facts()), [.resetCycle])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testWithAutomaticChecksOffASwitchWithNothingStagedDoesNothing() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts(checks: false)), [])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testAStagedNightlyIsResumedEvenWithAutomaticChecksOff() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts([staged], checks: false)), [.resume])
  }

  func testACancelledInstallerIsWatchedUntilItsCopyGoes() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testASwitchWhileSparkleIsBusyWaitsForIdleEvenWithoutACallback() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
  }

  func testAResumeThatEndsWithoutACancellationWaitsForTheDeadlineAndTouchesNothing() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed)
    XCTAssertEqual(machine.phase, .unconfirmed)
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(quit(&machine, 1, facts([staged])), [.unwatch, .resume])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed)
    XCTAssertEqual(machine.deadline(1), [mayInstall, .release([1])])
  }

  func testAnUnconfirmedCopyThatGoesAfterAllSettles() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.changed(facts()), [.unwatch])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testAnUnreadableCacheIsTriedButNeverConfirmedOrRemoved() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(unreadable()), [.resume])
    XCTAssertEqual(machine.changed(unreadable()), [.watch, unreadableLine])
    XCTAssertTrue(machine.holdsQuit(unreadable()))
  }

  func testACancellationWhileTheCacheCantBeReadIsWaitedForUntilItCanBe() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91"), [])
    XCTAssertEqual(machine.changed(unreadable()), [.watch])
    XCTAssertEqual(machine.phase, .cancelling(ChannelSwitch.Round(cancelledBuilds: ["91"], switched: true)))
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.phase, .cancelling(ChannelSwitch.Round(cancelled: [staged], switched: true)))
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle])
  }

  func testAFailedReadWhileCancellingKeepsWaitingForTheSameCopy() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.changed(unreadable()), [])
    XCTAssertEqual(machine.phase, .cancelling(ChannelSwitch.Round(cancelled: [staged], switched: true)))
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle])
  }

  func testADeadlineWithAnUnreadableCacheQuitsWithTheWarningAndRemovesNothing() {
    var machine = ChannelSwitch()
    XCTAssertEqual(quit(&machine, 1, unreadable()), [.resume])
    XCTAssertEqual(machine.deadline(1),
                   [.log("Sparkle's cache can't be read at the quit deadline; quitting, and a staged nightly may install"), .release([1])])
  }

  func testAnUnconfirmedRemovalSettlesTheRoundOnceTheCopyIsGone() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(quit(&machine, 1, facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed)
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .release([1])])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testACopyNoInstallerWasToldToCancelLeavesTheRoundUnconfirmed() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged, newer]))
    _ = machine.installerCancelled(build: "91")
    XCTAssertEqual(machine.changed(facts([staged, newer])), unconfirmed)
  }

  func testQuitWithNothingStagedAndNothingPendingGoesOnTheNextSurvey() {
    var machine = ChannelSwitch()
    XCTAssertEqual(quit(&machine, 1, facts()), [.release([1])])
    XCTAssertEqual(quit(&machine, 2, facts(busy: true)), [.release([2])])
  }

  func testAPendingSwitchHoldsQuitWhileSparkleIsBusyEvenWithNothingStagedYet() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertTrue(machine.holdsQuit(facts(busy: true)))
    XCTAssertEqual(quit(&machine, 1, facts(busy: true)), [])
    XCTAssertEqual(machine.changed(facts(busy: true)), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91"), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle, .release([1])])
  }

  func testAPendingSwitchReleasesQuitOnceSparkleIsIdleWithNothingStaged() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(quit(&machine, 1, facts(busy: true)), [])
    XCTAssertEqual(machine.changed(facts()), [.resetCycle, .release([1])])
  }

  func testAPendingSwitchHoldIsBoundByTheDeadline() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(quit(&machine, 1, facts(busy: true)), [])
    XCTAssertEqual(machine.deadline(1), [.release([1])])
    XCTAssertFalse(machine.holdsQuit(facts()))
  }

  func testQuitWithALiveStagedNightlyAndNoSwitchStartsADrop() {
    var machine = ChannelSwitch()
    XCTAssertEqual(quit(&machine, 1, facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91"), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .release([1])])
  }

  func testQuitsDuringARoundWaitForTheSameEnd() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(quit(&machine, 1, facts([staged])), [])
    XCTAssertEqual(quit(&machine, 2, facts([staged])), [])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle, .release([1, 2])])
  }

  func testADeadlineReleasesItsQuitOnceAndTheLaterDropDoesntAgain() {
    var machine = ChannelSwitch()
    XCTAssertEqual(quit(&machine, 1, facts([staged])), [.resume])
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.deadline(1), [mayInstall, .release([1])])
    XCTAssertEqual(machine.deadline(1), [])
    XCTAssertEqual(machine.changed(facts()), [])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testADeadlineAfterTheDropIsIgnored() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    _ = quit(&machine, 1, facts([staged]))
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle, .release([1])])
    XCTAssertEqual(machine.deadline(1), [])
  }

  func testADeadlineWithTheCopyAlreadyGoneQuitsWithoutTheWarning() {
    var machine = ChannelSwitch()
    _ = quit(&machine, 1, facts([staged]))
    XCTAssertEqual(machine.changed(facts(busy: true)), [])
    XCTAssertEqual(machine.deadline(1), [.release([1])])
  }

  func testASecondSwitchDuringTheResumeIsAppliedWhenItEnds() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.switched(), [])
    XCTAssertEqual(machine.changed(facts()), [.resetCycle])
  }

  func testASwitchWhileCancellingKeepsTheEvidence() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.switched(), [.unwatch])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
  }

  func testReturningToNightlyWhileCancellingSettlesAndAppliesIt() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts()), [.resetCycle])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testEvidenceCoversOnlyTheCopyItWasGivenFor() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.changed(facts(busy: true, [restaged])), [])
    XCTAssertEqual(machine.changed(facts([restaged])), [.unwatch, .resume])
    XCTAssertEqual(machine.changed(facts([restaged])), unconfirmed)
  }

  func testACancellationWithNoMatchingCopyIsNotEvidence() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.installerCancelled(build: "92"), [])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed)
  }

  func testACancellationInSparklesOwnSessionIsTrackedForQuit() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.installerCancelled(build: "91"), [])
    XCTAssertEqual(quit(&machine, 1, facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .release([1])])
  }

  func testACancellationAfterAnUnconfirmedRoundWatchesAgain() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.installerCancelled(build: "91"), [.unwatch])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
  }

  func testAnUnreadableEntryBesideAVerifiedNightlyDoesntHideIt() {
    var machine = ChannelSwitch()
    let abandoned = ChannelSwitch.Residue(folder: "/Installation/x", device: 1, inode: 20)
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(copies: [staged], residue: [abandoned])), .present([staged]))
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(copies: [staged], residue: [abandoned]), busy: true), .present([staged]))
  }

  func testAVerifiedCopyIsKeptWhileItsFolderCantBeReadAndDroppedOnceItsGone() {
    var machine = ChannelSwitch()
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(copies: [staged])), .present([staged]))
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(residue: [staged.residue])), .present([staged]))
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(blind: true)), .present([staged]))
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting()), .none)
    XCTAssertEqual(machine.known, [])
  }

  func testAFolderReplacedUnderTheSameNameIsntTheVerifiedCopy() {
    var machine = ChannelSwitch()
    _ = seen(&machine, ChannelSwitch.Sighting(copies: [staged]))
    let replaced = ChannelSwitch.Residue(folder: staged.folder, device: 1, inode: 99)
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(residue: [replaced])), .unreadable)
    XCTAssertEqual(machine.known, [])
  }

  func testAnUnreadableEntryIsUncertainWhetherSparkleIsBusyOrIdle() {
    var machine = ChannelSwitch()
    let sighting = ChannelSwitch.Sighting(residue: [ChannelSwitch.Residue(folder: "/Installation/x", device: 1, inode: 20)])
    XCTAssertEqual(seen(&machine, sighting, busy: true), .unreadable)
    XCTAssertEqual(seen(&machine, sighting), .unreadable)
  }

  func testQuitWithOnlyAnUnreadableEntryWhileIdleAsksSparkleToResumeItAndIsReleasedByTheDeadline() {
    var machine = ChannelSwitch()
    let sighting = ChannelSwitch.Sighting(residue: [ChannelSwitch.Residue(folder: "/Installation/x", device: 1, inode: 20)])
    let idle = machine.observe(sighting, busy: false, automaticChecks: true)
    XCTAssertTrue(machine.holdsQuit(idle))
    XCTAssertEqual(quit(&machine, 1, idle), [.resume])
    XCTAssertEqual(machine.changed(machine.observe(sighting, busy: true, automaticChecks: true)), [])
    XCTAssertEqual(machine.changed(machine.observe(sighting, busy: false, automaticChecks: true)), [.watch, unreadableLine])
    XCTAssertEqual(machine.deadline(1),
                   [.log("Sparkle's cache can't be read at the quit deadline; quitting, and a staged nightly may install"), .release([1])])
  }

  func testAnUnreadableEntryThatSparklesSkipClearsReleasesQuitAtOnce() {
    var machine = ChannelSwitch()
    let sighting = ChannelSwitch.Sighting(residue: [ChannelSwitch.Residue(folder: "/Installation/x", device: 1, inode: 20)])
    XCTAssertEqual(quit(&machine, 1, machine.observe(sighting, busy: false, automaticChecks: true)), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91"), [])
    XCTAssertEqual(machine.changed(machine.observe(sighting, busy: false, automaticChecks: true)), [.watch])
    XCTAssertEqual(machine.changed(machine.observe(ChannelSwitch.Sighting(), busy: false, automaticChecks: true)), [.unwatch, .release([1])])
  }

  func testACacheThatCantBeReadAtAllIsNeverAbsent() {
    var machine = ChannelSwitch()
    XCTAssertEqual(seen(&machine, ChannelSwitch.Sighting(blind: true)), .unreadable)
  }

  func testAStagedNightlyWithNoSwitchOrQuitIsLeftToSparkle() {
    var machine = ChannelSwitch()
    XCTAssertFalse(machine.wantsFacts)
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.phase, .idle)
  }
}
