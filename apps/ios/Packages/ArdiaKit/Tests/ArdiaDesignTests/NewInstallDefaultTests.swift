import ArdiaDesign
import Foundation
import Testing

struct NewInstallDefaultTests {
  static let rule = NewInstallDefault(setting: "collapse", marker: "settled", evidence: ["onboarded", "keyboard", "color"])

  private func suite() -> UserDefaults {
    UserDefaults(suiteName: "NewInstallDefaultTests-\(UUID().uuidString)")!
  }

  @Test func `a new install keeps the new default`() {
    let defaults = suite()
    Self.rule.settle(in: defaults)
    #expect(defaults.object(forKey: "collapse") == nil)
    #expect(defaults.bool(forKey: "settled"))
  }

  @Test func `a new install that finishes onboarding later still keeps the new default`() {
    let defaults = suite()
    Self.rule.settle(in: defaults)
    defaults.set(true, forKey: "onboarded")
    Self.rule.settle(in: defaults)
    #expect(defaults.object(forKey: "collapse") == nil)
  }

  @Test func `an existing install that never chose is moved to off once`() {
    for evidence in ["onboarded", "keyboard", "color"] {
      let defaults = suite()
      defaults.set("anything", forKey: evidence)
      Self.rule.settle(in: defaults)
      #expect(defaults.object(forKey: "collapse") as? Bool == false, "\(evidence)")
      #expect(defaults.bool(forKey: "settled"))
    }
  }

  @Test func `a choice already saved is never changed`() {
    let on = suite()
    on.set(true, forKey: "onboarded")
    on.set(true, forKey: "collapse")
    Self.rule.settle(in: on)
    #expect(on.object(forKey: "collapse") as? Bool == true)
    let off = suite()
    off.set(true, forKey: "onboarded")
    off.set(false, forKey: "collapse")
    Self.rule.settle(in: off)
    #expect(off.object(forKey: "collapse") as? Bool == false)
  }

  @Test func `it decides once, so a later switch to on is not undone`() {
    let defaults = suite()
    defaults.set(true, forKey: "onboarded")
    Self.rule.settle(in: defaults)
    defaults.removeObject(forKey: "collapse")
    Self.rule.settle(in: defaults)
    #expect(defaults.object(forKey: "collapse") == nil)
  }
}
