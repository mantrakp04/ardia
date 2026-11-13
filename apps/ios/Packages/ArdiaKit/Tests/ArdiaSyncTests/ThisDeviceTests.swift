import ArdiaSyncCore
import Foundation
import Testing
@testable import ArdiaSync

@MainActor
@Suite struct ThisDeviceTests {
  @Test func aPhoneSaysIPhoneInEveryWord() {
    let phone = ThisDevice(kind: .phone)
    #expect(phone.noun == "iPhone")
    #expect(phone.defaultName == "iPhone")
    #expect(phone.title == "This iPhone")
    #expect(phone.symbol == "iphone")
    #expect(phone.pairSymbol == "macbook.and.iphone")
    #expect(phone.offlineMessage == "Your iPhone isn’t connected to the internet.")
  }

  @Test func aTabletSaysIPadInEveryWord() {
    let tablet = ThisDevice(kind: .tablet)
    #expect(tablet.noun == "iPad")
    #expect(tablet.defaultName == "iPad")
    #expect(tablet.title == "This iPad")
    #expect(tablet.symbol == "ipad")
    #expect(tablet.pairSymbol == "macbook.and.ipad")
    #expect(tablet.offlineMessage == "Your iPad isn’t connected to the internet.")
  }

  @Test func aMacIsNeverThisDeviceSoItReadsAsAPhone() {
    #expect(ThisDevice(kind: .mac).noun == "iPhone")
  }

  @Test func theModelIdentifierDecidesTheKind() {
    #expect(ThisDevice.kind(model: "iPad14,3") == .tablet)
    #expect(ThisDevice.kind(model: "iPad16,6") == .tablet)
    #expect(ThisDevice.kind(model: "iPhone17,1") == .phone)
    #expect(ThisDevice.kind(model: "iPhone Duo") == .phone)
    #expect(ThisDevice.kind(model: "arm64") == .phone)
    #expect(ThisDevice.kind(model: "Mac15,3") == .phone)
    #expect(ThisDevice.kind(model: "") == .phone)
  }

  @Test func theSimulatorsModelBeatsTheHardwareOne() {
    #expect(ThisDevice.kind(simulatorModel: "iPad16,6", hardwareModel: "arm64") == .tablet)
    #expect(ThisDevice.kind(simulatorModel: "iPhone18,1", hardwareModel: "arm64") == .phone)
    #expect(ThisDevice.kind(simulatorModel: nil, hardwareModel: "iPad14,3") == .tablet)
    #expect(ThisDevice.kind(simulatorModel: "", hardwareModel: "iPad14,3") == .tablet)
    #expect(ThisDevice.kind(simulatorModel: nil, hardwareModel: "iPhone17,1") == .phone)
  }

  @Test func aSyncedDeviceNamesItselfByItsKind() {
    let phone = SyncedDevice(id: "p", name: "iPhone", kind: .phone, lastSeen: nil, isCurrent: true, canReceiveTabs: true)
    let tablet = SyncedDevice(id: "t", name: "iPad", kind: .tablet, lastSeen: nil, isCurrent: true, canReceiveTabs: true)
    let other = SyncedDevice(id: "o", name: "iPad", kind: .tablet, lastSeen: nil, isCurrent: false, canReceiveTabs: true)
    #expect(phone.detail == "This iPhone")
    #expect(tablet.detail == "This iPad")
    #expect(other.detail == nil)
  }

  @Test func aFreshTabletIsNamedIPadAndSyncPublishesThatName() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    #expect(service.deviceName == "iPad")
    #expect(service.deviceKind == .tablet)
  }

  @Test func aFreshPhoneIsNamedIPhone() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .phone)
    #expect(service.deviceName == "iPhone")
  }

  @Test func aNameTheDeviceAlreadyHasIsKept() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let named = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    named.deviceName = "Kitchen iPad"
    let again = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    #expect(again.deviceName == "Kitchen iPad")
    again.deviceName = "iPhone 15 stand"
    let reopened = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    #expect(reopened.deviceName == "iPhone 15 stand")
  }

  @Test func aTabletThatSavedTheOldPhoneDefaultIsNamedIPad() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let old = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .phone)
    old.deviceName = "iPhone"
    let nowATablet = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    #expect(nowATablet.deviceName == "iPad")
  }

  @Test func aPhoneThatSavedTheTabletDefaultIsNamedIPhone() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let tablet = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    tablet.deviceName = "iPad"
    let phone = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .phone)
    #expect(phone.deviceName == "iPhone")
  }

  @Test func theOtherKindsDefaultIsRecognisedOnlyWhenItIsTheWholeName() {
    #expect(ThisDevice(kind: .tablet).isOtherKindsDefault("iPhone"))
    #expect(ThisDevice(kind: .phone).isOtherKindsDefault("iPad"))
    #expect(!ThisDevice(kind: .tablet).isOtherKindsDefault("iPad"))
    #expect(!ThisDevice(kind: .phone).isOtherKindsDefault("iPhone"))
    #expect(!ThisDevice(kind: .tablet).isOtherKindsDefault("iPhone of Sam"))
    #expect(!ThisDevice(kind: .tablet).isOtherKindsDefault("Kitchen iPhone"))
    #expect(!ThisDevice(kind: .tablet).isOtherKindsDefault(""))
  }

  @Test func clearingTheNameGoesBackToTheDevicesDefault() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    service.deviceName = "Kitchen iPad"
    service.deviceName = "   "
    let reopened = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    #expect(reopened.deviceName == "iPad")
  }

  @Test func theLockedStatusNamesTheDevice() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let tablet = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .tablet)
    #expect(tablet.lockedStatusText == "Enter your recovery phrase to keep syncing on this iPad.")
    let phone = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys), deviceKind: .phone)
    #expect(phone.lockedStatusText == "Enter your recovery phrase to keep syncing on this iPhone.")
  }

  @Test func theDemoDeviceFollowsTheDevice() {
    let demo = SyncService.demo
    #expect(demo.deviceName == ThisDevice.current.defaultName)
    let current = demo.snapshot.devices.first { $0.isCurrent }
    #expect(current?.name == ThisDevice.current.defaultName)
    #expect(current?.kind == ThisDevice.current.kind)
  }
}
