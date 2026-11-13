@testable import ArdiaDesign
import SwiftUI
import Testing

struct DeviceFeaturesTests {
  @Test func `the system hinge statuses map to the three hinge states`() throws {
    guard #available(iOS 27.1, macOS 27.1, *) else { return }
    #expect(HingeState(DeviceHinge.Status.closed) == .closed)
    #expect(HingeState(DeviceHinge.Status.partiallyOpen) == .partial)
    #expect(HingeState(DeviceHinge.Status.fullyOpen) == .open)
    #expect(HingeState(nil) == nil)
  }

  @Test func `reserved area kinds map to the system's kinds`() {
    guard #available(iOS 27.1, macOS 27.1, *) else { return }
    #expect(ReservedArea.Kind.occlusion.system == ReservedRegion.Kind.occlusion)
    #expect(ReservedArea.Kind.division.system == ReservedRegion.Kind.division)
  }
}
