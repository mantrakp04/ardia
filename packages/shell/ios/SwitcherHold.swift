import AppKit

enum SwitcherHold {
  private static var held: NSEvent.ModifierFlags = []

  static func opened(by item: CommandItem) {
    let mods = MainMenu.heldModifiers(of: item)
    let event = NSApp.currentEvent
    held = !mods.isEmpty && event?.type == .keyDown && event?.modifierFlags.isSuperset(of: mods) == true ? mods : []
    if held.isEmpty { DispatchQueue.main.async { ShellEvents.send(.app, ["type": "switcherReleased"]) } }
  }

  static func released(by flags: NSEvent.ModifierFlags) -> Bool {
    guard !held.isEmpty, !flags.isSuperset(of: held) else { return false }
    held = []
    return true
  }
}
