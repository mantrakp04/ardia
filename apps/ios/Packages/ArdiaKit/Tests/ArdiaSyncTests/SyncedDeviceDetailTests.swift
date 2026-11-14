import Foundation
import Testing
@testable import ArdiaSync

@Suite struct SyncedDeviceDetailTests {
  let now = Date(timeIntervalSince1970: 1_800_000_000)

  @Test func anotherDeviceShowsNoTimeBecauseNothingSaysWhenItLastSynced() {
    let idle = SyncedDevice(id: "mac", name: "MacBook Pro", kind: .mac, lastSeen: now.addingTimeInterval(-6 * 3600), isCurrent: false, canReceiveTabs: true)
    let busy = SyncedDevice(id: "studio", name: "Mac Studio", kind: .mac, lastSeen: now.addingTimeInterval(-5), isCurrent: false, canReceiveTabs: true)
    let unknown = SyncedDevice(id: "air", name: "MacBook Air", kind: .mac, lastSeen: nil, isCurrent: false, canReceiveTabs: false)
    #expect(idle.detail == nil)
    #expect(busy.detail == nil)
    #expect(unknown.detail == nil)
  }

  @Test func thisIPhoneIsNamedAsSuch() {
    let phone = SyncedDevice(id: "phone", name: "iPhone", kind: .phone, lastSeen: nil, isCurrent: true, canReceiveTabs: true)
    #expect(phone.detail == "This iPhone")
  }
}
