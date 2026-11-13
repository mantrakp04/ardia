import ArdiaDesign
import Foundation
import SwiftUI
import Testing

struct BrowserCommandTests {
  @Test func `every command names an entry in the Mac's command table`() throws {
    let mac = try MacCommandTable.load()
    for command in BrowserCommand.allCases {
      #expect(mac[command.macName] != nil, "\(command) -> \(command.macName)")
    }
  }

  @Test func `every shortcut is the Mac's, in the Mac's order, leaving out keys an iPad keyboard lacks`() throws {
    let mac = try MacCommandTable.load()
    for command in BrowserCommand.allCases {
      let expected = (mac[command.macName] ?? []).filter(\.isExpressible)
      #expect(command.shortcuts == expected, "\(command)")
      #expect(!command.shortcuts.isEmpty, "\(command) has no shortcut")
    }
  }

  @Test func `no two commands answer to the same keys`() {
    var owners: [CommandShortcut: BrowserCommand] = [:]
    for command in BrowserCommand.allCases {
      for shortcut in command.shortcuts {
        #expect(owners[shortcut] == nil, "\(command) and \(owners[shortcut].map(String.init(describing:)) ?? "") share \(shortcut)")
        owners[shortcut] = command
      }
    }
  }

  @Test func `the spec's commands are all there`() {
    let required: [BrowserCommand] = [
      .newTab, .closeTab, .reopenClosedTab, .openLocation, .reload, .back, .forward, .findInPage,
      .zoomIn, .zoomOut, .actualSize, .nextTab, .previousTab, .selectTab1, .selectTab8, .selectLastTab,
      .toggleSidebar, .nextSpace, .previousSpace, .newIncognitoTab, .print, .settings,
    ]
    for command in required {
      #expect(BrowserCommand.allCases.contains(command))
    }
  }

  @Test func `spot checks against the Mac`() {
    #expect(BrowserCommand.newTab.primaryShortcut == CommandShortcut("t", [.command]))
    #expect(BrowserCommand.newIncognitoTab.primaryShortcut == CommandShortcut("n", [.shift, .command]))
    #expect(BrowserCommand.toggleSidebar.primaryShortcut == CommandShortcut("s", [.command]))
    #expect(BrowserCommand.openLocation.shortcuts == [CommandShortcut("l", [.command])])
    #expect(BrowserCommand.back.shortcuts.contains(CommandShortcut("\u{F702}", [.command])))
    #expect(BrowserCommand.nextSpace.primaryShortcut == CommandShortcut("\u{F703}", [.option, .command]))
    #expect(BrowserCommand.settings.primaryShortcut == CommandShortcut(",", [.command]))
    #expect(BrowserCommand.selectLastTab.primaryShortcut == CommandShortcut("9", [.command]))
  }

  @Test func `Mac key codes become SwiftUI keys`() {
    #expect(CommandShortcut("\u{F700}", []).keyEquivalent == .upArrow)
    #expect(CommandShortcut("\u{F701}", []).keyEquivalent == .downArrow)
    #expect(CommandShortcut("\u{F702}", []).keyEquivalent == .leftArrow)
    #expect(CommandShortcut("\u{F703}", []).keyEquivalent == .rightArrow)
    #expect(CommandShortcut("\u{F72C}", []).keyEquivalent == .pageUp)
    #expect(CommandShortcut("\u{F72D}", []).keyEquivalent == .pageDown)
    #expect(CommandShortcut("\u{8}", []).keyEquivalent == .delete)
    #expect(CommandShortcut("\u{D}", []).keyEquivalent == .return)
    #expect(CommandShortcut("\u{9}", []).keyEquivalent == .tab)
    #expect(CommandShortcut("[", []).keyEquivalent == KeyEquivalent("["))
    #expect(CommandShortcut("\u{F708}", []).keyEquivalent == nil)
    #expect(!CommandShortcut("\u{F708}", [.control]).isExpressible)
  }

  @Test func `Mac modifiers become SwiftUI modifiers`() {
    #expect(CommandShortcut("t", [.command]).eventModifiers == .command)
    #expect(CommandShortcut("t", [.shift, .command]).eventModifiers == [.shift, .command])
    #expect(CommandShortcut("t", [.option, .control]).eventModifiers == [.option, .control])
  }

  @Test func `number commands pick a tab by position, and nine picks the last`() {
    #expect(BrowserCommand.selectTab1.tabIndex(count: 5) == 0)
    #expect(BrowserCommand.selectTab8.tabIndex(count: 5) == nil)
    #expect(BrowserCommand.selectTab8.tabIndex(count: 8) == 7)
    #expect(BrowserCommand.selectLastTab.tabIndex(count: 5) == 4)
    #expect(BrowserCommand.selectLastTab.tabIndex(count: 0) == nil)
    #expect(BrowserCommand.newTab.tabIndex(count: 5) == nil)
    #expect(BrowserCommand.numberedTabs.count == 9)
  }

  @Test func `next and previous tab wrap around the list`() {
    #expect(TabStep.index(from: 0, by: 1, count: 3) == 1)
    #expect(TabStep.index(from: 2, by: 1, count: 3) == 0)
    #expect(TabStep.index(from: 0, by: -1, count: 3) == 2)
    #expect(TabStep.index(from: nil, by: 1, count: 3) == 0)
    #expect(TabStep.index(from: nil, by: -1, count: 3) == 2)
    #expect(TabStep.index(from: 0, by: 1, count: 1) == nil)
    #expect(TabStep.index(from: nil, by: 1, count: 0) == nil)
  }
}

enum MacCommandTable {
  struct Missing: Error {}

  static func load() throws -> [String: [CommandShortcut]] {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { root.deleteLastPathComponent() }
    let source = try String(contentsOf: root.appending(path: "packages/shell/ios/CommandTable.swift"), encoding: .utf8)
    guard let start = source.range(of: "static let keys") else { throw Missing() }
    var table: [String: [CommandShortcut]] = [:]
    let entry = /^\s*"([^"]+)": \[(.*)\],\s*$/
    let pair = /\("((?:\\u\{[0-9A-Fa-f]+\}|[^"\\])+)", \[([^\]]*)\]\)/
    for line in source[start.upperBound...].split(separator: "\n") {
      guard let match = String(line).wholeMatch(of: entry) else { continue }
      table[String(match.1)] = String(match.2).matches(of: pair).map { found in
        CommandShortcut(decode(String(found.1)), modifiers(String(found.2)))
      }
    }
    return table
  }

  private static func decode(_ literal: String) -> String {
    guard literal.hasPrefix("\\u{"), let scalar = UInt32(literal.dropFirst(3).dropLast(), radix: 16).flatMap(Unicode.Scalar.init) else {
      return literal
    }
    return String(Character(scalar))
  }

  private static func modifiers(_ list: String) -> CommandModifiers {
    var result: CommandModifiers = []
    for name in list.split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }) {
      switch name {
      case ".command": result.insert(.command)
      case ".shift": result.insert(.shift)
      case ".option": result.insert(.option)
      case ".control": result.insert(.control)
      case ".function": result.insert(.function)
      default: break
      }
    }
    return result
  }
}
