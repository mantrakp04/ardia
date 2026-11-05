import AppKit
import ArdiaCore
import ExpoModulesCore

public class MenusModule: Module {
  private let lifetime = ModuleLifetime()

  public func definition() -> ModuleDefinition {
    Name("ArdiaMenus")
    Events(ShellEvents.Channel.command.rawValue)

    OnCreate {
      self.lifetime.begin(self) {
        ShortcutRecorder.shared.abandon(by: self)
        ShellEvents.retire(self)
      }
      ShellEvents.attach(.command, to: self, while: self.lifetime)
      self.lifetime.onMain { NSApp.mainMenu = MainMenu.build() }
    }

    OnDestroy {
      self.lifetime.end()
      ShellEvents.detach(self)
    }

    AsyncFunction("setMenuState") { (state: MenuStateUpdate) in
      MenuState.current = MenuState(state)
      MainMenu.refresh()
    }.runOnQueue(.main)
    AsyncFunction("setMenuBookmarks") { (bookmarks: MenuBookmarks) in
      MenuState.setBookmarks(bookmarks)
      MainMenu.refresh()
    }.runOnQueue(.main)
    AsyncFunction("showMenu") { (items: [MenuItem], promise: Promise) in
      if let file = MenuChoice.testFile(flag: "appMenu", name: "menu.json") {
        promise.resolve(MenuChoice.testPick(items, dumpingTo: file, appContext: self.appContext))
        return
      }
      let target = MenuChoice()
      let menu = MenusModule.contextMenu(items, target: target)
      menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      DispatchQueue.main.async { promise.resolve(target.chosen) }
    }.runOnQueue(.main)

    AsyncFunction("menuShortcuts") { () -> [[String: Any]] in MainMenu.shortcutList() }.runOnQueue(.main)

    AsyncFunction("recordShortcut") { [weak self] (promise: Promise) in
      guard let self else { return }
      self.lifetime.run { ShortcutRecorder.shared.record(promise, for: self) }
    }.runOnQueue(.main)
    AsyncFunction("cancelRecording") { ShortcutRecorder.shared.finish(nil) }.runOnQueue(.main)
  }

  static func contextMenu(_ items: [MenuItem], target: MenuChoice) -> NSMenu {
    let menu = NSMenu()
    menu.autoenablesItems = false
    for item in items {
      if item.separator {
        menu.addItem(.separator())
        continue
      }
      let entry = NSMenuItem(title: item.title, action: nil, keyEquivalent: item.key)
      if !item.modifiers.isEmpty { entry.keyEquivalentModifierMask = ModifierName.flags(item.modifiers) }
      if let children = item.children {
        entry.submenu = contextMenu(children, target: target)
      } else if item.share {
        let id = item.id
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        SharePicker.menuItems(target: target, action: #selector(MenuChoice.choose(_:)), choice: { "\(id):via:\($0)" })
          .forEach(submenu.addItem)
        entry.submenu = submenu
      } else {
        entry.action = #selector(MenuChoice.choose(_:))
        entry.target = target
        entry.representedObject = item.id
      }
      entry.isAlternate = item.alternate
      entry.isEnabled = item.enabled
      entry.state = item.checked ? .on : .off
      if let symbol = item.symbol {
        entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        if #available(macOS 27.0, *) { entry.preferredImageVisibility = .visible }
      } else if let hex = item.swatch, let light = RGBA(hex: hex)?.srgb {
        let dark = item.swatchDark.flatMap { RGBA(hex: $0)?.srgb } ?? light
        entry.image = light.alphaComponent == 0
          ? emptySwatch() : swatch(NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light })
        if #available(macOS 27.0, *) { entry.preferredImageVisibility = .visible }
      }
      menu.addItem(entry)
    }
    return menu
  }

  static func swatch(_ color: NSColor) -> NSImage {
    NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
      color.setFill()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
      NSColor.black.withAlphaComponent(0.15).setStroke()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).stroke()
      return true
    }
  }

  static func emptySwatch() -> NSImage {
    NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
      NSColor.tertiaryLabelColor.setStroke()
      NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).stroke()
      return true
    }
  }
}
