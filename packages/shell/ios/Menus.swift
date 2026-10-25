import AppKit

struct MenuState {
  struct Entry: Equatable {
    let id: String
    let title: String
    let current: Bool
  }

  struct Bookmark {
    let id: String
    let title: String
    let url: String?
    let children: [Bookmark]?
  }

  static var current = MenuState()

  var checked = Set<String>()
  var disabled = Set<String>()
  var titles: [String: String] = [:]
  var profiles: [Entry] = []
  var windows: [Entry] = []
  var bookmarkFolders: [Entry] = []
  var recentBookmarks: [Bookmark] = []
  var bookmarksBar: [Bookmark] = []
  var otherBookmarks: [Bookmark] = []
  var bookmarksRevision: Int?
  var recentlyClosed: [Entry] = []
  var recentlyClosedGroups: [Entry] = []
  var warnBeforeQuitting = false
  var warnBeforeClosingWindow = false
  var undoReopensClosedTab = false
  var downloadsInProgress = 0
  var shortcuts: [String: [String]] = [:]
  var extensions: [(id: String, title: String, icon: String?)] = []
  var fromApp = false

  init() {}

  static func bookmarks(_ list: Any?) -> [Bookmark] {
    (list as? [[String: Any]] ?? []).map {
      Bookmark(
        id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", url: $0["url"] as? String,
        children: $0["children"] == nil ? nil : bookmarks($0["children"]))
    }
  }

  private(set) static var sentBookmarks: (state: MenuState, revision: Int)?

  static func setBookmarks(_ d: [String: Any]) {
    var state = MenuState()
    state.bookmarkFolders = (d["bookmarkFolders"] as? [[String: Any]] ?? []).map {
      Entry(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", current: $0["current"] as? Bool ?? false)
    }
    state.recentBookmarks = bookmarks(d["recentBookmarks"])
    state.bookmarksBar = bookmarks(d["bookmarksBar"])
    state.otherBookmarks = bookmarks(d["otherBookmarks"])
    let revision = (sentBookmarks?.revision ?? 0) + 1
    sentBookmarks = (state, revision)
    current.bookmarkFolders = state.bookmarkFolders
    current.recentBookmarks = state.recentBookmarks
    current.bookmarksBar = state.bookmarksBar
    current.otherBookmarks = state.otherBookmarks
    current.bookmarksRevision = revision
  }

  init(_ d: [String: Any]) {
    func strings(_ key: String) -> [String] { d[key] as? [String] ?? [] }
    func entries(_ key: String) -> [Entry] {
      (d[key] as? [[String: Any]] ?? []).map {
        Entry(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", current: $0["current"] as? Bool ?? false)
      }
    }
    checked = Set(strings("checked"))
    disabled = Set(strings("disabled"))
    titles = d["titles"] as? [String: String] ?? [:]
    profiles = entries("profiles")
    windows = entries("windows")
    if d["bookmarksBar"] == nil, let sent = MenuState.sentBookmarks {
      (bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks) =
        (sent.state.bookmarkFolders, sent.state.recentBookmarks, sent.state.bookmarksBar, sent.state.otherBookmarks)
      bookmarksRevision = sent.revision
    } else {
      bookmarkFolders = entries("bookmarkFolders")
      recentBookmarks = Self.bookmarks(d["recentBookmarks"])
      bookmarksBar = Self.bookmarks(d["bookmarksBar"])
      otherBookmarks = Self.bookmarks(d["otherBookmarks"])
    }
    recentlyClosed = entries("recentlyClosed")
    recentlyClosedGroups = entries("recentlyClosedGroups")
    warnBeforeQuitting = d["warnBeforeQuitting"] as? Bool ?? false
    warnBeforeClosingWindow = d["warnBeforeClosingWindow"] as? Bool ?? false
    undoReopensClosedTab = d["undoReopensClosedTab"] as? Bool ?? false
    downloadsInProgress = d["downloadsInProgress"] as? Int ?? 0
    shortcuts = d["shortcuts"] as? [String: [String]] ?? [:]
    fromApp = true
    extensions = (d["extensions"] as? [[String: Any]] ?? []).map {
      (id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", icon: $0["icon"] as? String)
    }
  }
}

protocol Rebindable: NSMenuItem {
  var shortcutId: String { get }
  var defaultTitle: String { get }
  var defaultKey: String { get }
  var defaultModifiers: NSEvent.ModifierFlags { get }
}

final class StandardItem: NSMenuItem, Rebindable {
  let shortcutId: String
  let defaultTitle: String
  let defaultKey: String
  let defaultModifiers: NSEvent.ModifierFlags

  init(_ title: String, _ action: Selector, key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
    shortcutId = "std:" + NSStringFromSelector(action)
    defaultTitle = title
    defaultKey = key
    defaultModifiers = mods
    let shortcut = MainMenu.keyEquivalent(key, mods)
    super.init(title: title, action: action, keyEquivalent: shortcut.key)
    keyEquivalentModifierMask = shortcut.mods
    identifier = NSUserInterfaceItemIdentifier("ardia.shortcut." + shortcutId)
  }

  override init(title: String, action: Selector?, keyEquivalent: String) {
    shortcutId = "std:" + (action.map(NSStringFromSelector) ?? title)
    defaultTitle = title
    defaultKey = keyEquivalent
    defaultModifiers = .command
    super.init(title: title, action: action, keyEquivalent: keyEquivalent)
    identifier = NSUserInterfaceItemIdentifier("ardia.shortcut." + shortcutId)
  }

  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

final class CommandItem: NSMenuItem, Rebindable {
  let command: String
  let arg: String?
  let defaultTitle: String
  var windowless = false
  var tracksChecked = true
  var hidesWhenDisabled = false
  private(set) var commandAlternateOf: CommandItem?
  let defaultKey: String
  let defaultModifiers: NSEvent.ModifierFlags

  var stateKey: String { arg.map { "\(command):\($0)" } ?? command }
  var shortcutId: String { stateKey }

  init(_ title: String, _ command: String, arg: String? = nil, key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
    self.command = command
    self.arg = arg
    defaultTitle = title
    defaultKey = key
    defaultModifiers = mods
    let shortcut = MainMenu.keyEquivalent(key, mods)
    super.init(title: title, action: #selector(MenuTarget.performCommand(_:)), keyEquivalent: shortcut.key)
    keyEquivalentModifierMask = shortcut.mods
    identifier = NSUserInterfaceItemIdentifier("ardia.command." + command)
    target = MenuTarget.shared
    tag = Self.chromeMenuTag
  }

  static let chromeMenuTag = 1

  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func hiddenShortcut() -> CommandItem {
    isHidden = true
    allowsKeyEquivalentWhenHidden = true
    return self
  }

  func hiddenWhenDisabled() -> CommandItem {
    hidesWhenDisabled = true
    allowsKeyEquivalentWhenHidden = true
    return self
  }

  func alternate() -> CommandItem {
    isAlternate = true
    return self
  }

  func commandAlternate(of primary: CommandItem) -> CommandItem {
    commandAlternateOf = primary
    isAlternate = true
    return self
  }

  func followPrimaryShortcut(bound: Set<String>) {
    guard let primary = commandAlternateOf else { return }
    let mods = primary.keyEquivalentModifierMask.union(.command)
    if keyEquivalent != primary.keyEquivalent { keyEquivalent = primary.keyEquivalent }
    if keyEquivalentModifierMask != mods { keyEquivalentModifierMask = mods }
    let collides = !primary.keyEquivalent.isEmpty && bound.contains(MainMenu.comboKey(primary.keyEquivalent, mods))
    let hidden = primary.keyEquivalentModifierMask.contains(.command) || collides
    if isHidden != hidden { isHidden = hidden }
  }
}

enum SwitcherHold {
  static var onRelease: (() -> Void)?
  private static var held: NSEvent.ModifierFlags = []

  static func opened(by item: CommandItem) {
    let mods = MainMenu.heldModifiers(of: item)
    let event = NSApp.currentEvent
    held = !mods.isEmpty && event?.type == .keyDown && event?.modifierFlags.isSuperset(of: mods) == true ? mods : []
    if held.isEmpty { DispatchQueue.main.async { onRelease?() } }
  }

  static func released(by flags: NSEvent.ModifierFlags) -> Bool {
    guard !held.isEmpty, !flags.isSuperset(of: held) else { return false }
    held = []
    return true
  }
}

final class MenuTarget: NSObject, NSMenuItemValidation {
  static let shared = MenuTarget()
  var handler: ((String, String?, String?) -> Void)?

  private static let focusMovingCommands: Set<String> = ["newTab", "focusCommandBar", "findInPage"]

  @objc(commandDispatch:) func performCommand(_ sender: NSMenuItem) {
    guard let item = sender as? CommandItem else { return }
    _ = FocusHandoff.shared.takeBegun()
    if Self.focusMovingCommands.contains(item.command) || FocusHandoff.shared.gatesKeyWindow, let window = NSApp.keyWindow {
      FocusHandoff.shared.begin(in: window)
    }
    handler?(item.command, item.arg, item.windowless ? nil : WindowManager.shared.keyWindowId)
    if item.command == "tabSwitcher" { SwitcherHold.opened(by: item) }
  }

  @objc(cut:) func cutEdit(_ sender: Any?) { forwardEdit(#selector(NSText.cut(_:)), from: sender) }
  @objc(copy:) func copyEdit(_ sender: Any?) { forwardEdit(#selector(NSText.copy(_:)), from: sender) }
  @objc(paste:) func pasteEdit(_ sender: Any?) { forwardEdit(#selector(NSText.paste(_:)), from: sender) }
  @objc(selectAll:) func selectAllEdit(_ sender: Any?) { forwardEdit(#selector(NSText.selectAll(_:)), from: sender) }

  static let undoAction = Selector(("undo:"))

  @objc(undo:) func undoOrReopenClosedTab(_ sender: Any?) {
    if Self.undoReopensClosedTab {
      handler?("reopenClosedTab", nil, WindowManager.shared.keyWindowId)
    } else {
      NSApp.sendAction(Self.undoAction, to: nil, from: sender)
    }
  }

  private static var undoReopensClosedTab: Bool {
    let state = MenuState.current
    guard state.undoReopensClosedTab, !state.disabled.contains("reopenClosedTab"),
      WindowManager.shared.keyWindowId != "settings", let window = WindowManager.shared.keyBrowserWindow
    else { return false }
    return !MainMenu.editsText(window.firstResponder)
  }

  private func forwardEdit(_ action: Selector, from sender: Any?) {
    if FocusHandoff.shared.defers(action) { return }
    FocusHandoff.shared.noteForwarded(action)
    NSApp.sendAction(action, to: nil, from: sender)
  }

  private static func validateForwarded(_ menuItem: NSMenuItem, _ action: Selector) -> Bool {
    guard let target = NSApp.target(forAction: action) as? NSObject else { return false }
    typealias Validate = @convention(c) (AnyObject, Selector, NSMenuItem) -> ObjCBool
    for name in ["validateMenuItem:", "validateUserInterfaceItem:"] {
      let validate = NSSelectorFromString(name)
      if target.responds(to: validate) {
        return unsafeBitCast(target.method(for: validate), to: Validate.self)(target, validate, menuItem).boolValue
      }
    }
    return true
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    if let action = menuItem.action, FocusHandoff.editActions.contains(action), FocusHandoff.shared.gatesKeyWindow { return true }
    if let action = menuItem.action, FocusHandoff.editActions.contains(action), !(menuItem is CommandItem),
      action != #selector(pasteAndMatchStyle(_:)) {
      return Self.validateForwarded(menuItem, action)
    }
    if menuItem.action == #selector(closeWindow(_:)) { return WindowManager.shared.closableWindow != nil }
    if menuItem.action == #selector(toggleKeepOnTop(_:)) {
      guard let window = WindowManager.shared.keyBrowserWindow else { return false }
      menuItem.state = window.level == .floating ? .on : .off
      return true
    }
    if menuItem.action == Self.undoAction {
      let reopens = Self.undoReopensClosedTab
      let title = reopens ? "Undo Close Tab" : (menuItem as? StandardItem)?.defaultTitle ?? menuItem.title
      if menuItem.title != title { menuItem.title = title }
      return reopens || Self.validateForwarded(menuItem, Self.undoAction)
    }
    guard let item = menuItem as? CommandItem else { return true }
    let state = MenuState.current
    if item.tracksChecked { item.state = state.checked.contains(item.stateKey) ? .on : .off }
    let title = state.titles[item.stateKey] ?? item.defaultTitle
    if item.title != title { item.title = title }
    if item.keyEquivalent == "\r", NSApp.keyWindow?.firstResponder is NSText { return false }
    if MainMenu.movesCaret(item), NSApp.currentEvent?.type == .keyDown, MainMenu.editsText(NSApp.keyWindow?.firstResponder) { return false }
    if item.command == "findInPage", WindowManager.shared.keyWindowId == "settings" { return true }
    let enabled = !state.disabled.contains(item.stateKey) && !state.disabled.contains(item.command)
    if item.hidesWhenDisabled, item.isHidden == enabled { item.isHidden = !enabled }
    return enabled
  }

  @objc func quit(_ sender: Any?) { WindowManager.shared.confirmQuit() }
  @objc func arrangeWindowsInFront(_ sender: Any?) { NSApp.arrangeInFront(sender) }
  @objc func toggleKeepOnTop(_ sender: Any?) { WindowManager.shared.toggleKeepOnTop() }
  @objc func closeWindow(_ sender: Any?) { WindowManager.shared.closableWindow?.performClose(sender) }

  @objc func pasteAndMatchStyle(_ sender: Any?) {
    let web = Selector(("pasteAndMatchStyle:"))
    if FocusHandoff.shared.defers(web) { return }
    if NSApp.target(forAction: web) != nil {
      NSApp.sendAction(web, to: nil, from: sender)
    } else {
      NSApp.sendAction(#selector(NSTextView.pasteAsPlainText(_:)), to: nil, from: sender)
    }
  }
}

enum MainMenu {
  private static var moveToProfile = NSMenu(title: "Move to Profile")
  private static var moveToWindow = NSMenu(title: "Move to Window")
  private static var bookmarkToFolder = NSMenu(title: "Add Bookmark to Folder")
  private static var profiles = NSMenu(title: "Profiles")
  private static var profilesItem = NSMenuItem(title: "Profiles", action: nil, keyEquivalent: "")
  private static var profilesSeparator = NSMenuItem.separator()
  private static var littleArdiaInProfile = NSMenu(title: "New Little Ardia Window in Profile")
  private static var littleArdiaInProfileItem = NSMenuItem(title: "New Little Ardia Window in Profile", action: nil, keyEquivalent: "")
  private static var bookmarks = NSMenu(title: "Bookmarks")
  private static var bookmarksFixedCount = 0
  private static var history = NSMenu(title: "History")
  private static var extensions = NSMenu(title: "Extensions")
  private static var extensionIcons: [String: NSImage] = [:]
  private static var undo: StandardItem?

  static func build() -> NSMenu {
    let appName = ProcessInfo.processInfo.processName
    let main = NSMenu()
    moveToProfile = NSMenu(title: "Move to Profile")
    moveToWindow = NSMenu(title: "Move to Window")
    bookmarkToFolder = NSMenu(title: "Add Bookmark to Folder")
    profiles = NSMenu(title: "Profiles")
    profilesSeparator = NSMenuItem.separator()
    littleArdiaInProfile = NSMenu(title: "New Little Ardia Window in Profile")

    func std(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> StandardItem {
      StandardItem(title, action, key: key, mods)
    }
    func sub(_ title: String, _ items: [NSMenuItem], menu: NSMenu? = nil) -> NSMenuItem {
      let submenu = menu ?? NSMenu(title: title)
      submenu.autoenablesItems = true
      items.forEach(submenu.addItem)
      let root = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      root.submenu = submenu
      return root
    }
    func top(_ title: String, _ items: [NSMenuItem], menu: NSMenu? = nil) -> NSMenu {
      let item = sub(title, items, menu: menu)
      main.addItem(item)
      return item.submenu!
    }
    func cmd(_ title: String, _ command: String, arg: String? = nil, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> CommandItem {
      CommandItem(title, command, arg: arg, key: key, mods)
    }

    let shareMenu = NSMenu(title: "Share")
    shareMenu.delegate = ShareMenu.shared

    let quit = std("Quit \(appName)", #selector(MenuTarget.quit(_:)), "q")
    quit.target = MenuTarget.shared
    let closeWindow = std("Close Window", #selector(MenuTarget.closeWindow(_:)), "w", [.command, .shift])
    closeWindow.target = MenuTarget.shared
    let services = NSMenu(title: "Services")
    NSApp.servicesMenu = services
    _ = top(appName, [
      aboutItem("About \(appName)"),
      updatesItem(),
      .separator(),
      cmd("Settings…", "openSettings", ","),
      cmd("Import from Another Browser…", "importBrowserData"),
      .separator(),
      sub("Services", [], menu: services),
      .separator(),
      std("Hide \(appName)", #selector(NSApplication.hide(_:)), "h"),
      std("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      std("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      quit,
    ])

    littleArdiaInProfileItem = sub("New Little Ardia Window in Profile", [], menu: littleArdiaInProfile)
    _ = top("File", [
      cmd("New Tab", "newTab", "t"),
      cmd("New Tab in Group", "newTabInGroup", "t", [.command, .option]),
      cmd("New Window", "newWindow", "n"),
      cmd("New Incognito Window", "newIncognitoWindow", "n", [.command, .shift]),
      cmd("New Little Ardia Window", "newLittleArdia", "n", [.command, .option]),
      littleArdiaInProfileItem,
      cmd("Open Links from Other Apps in Main Window", "toggleOpenLinksInLittleArdia"),
      cmd("Reopen Closed Tab", "reopenClosedTab", "t", [.command, .shift]),
      cmd("Reopen Closed Window", "reopenClosedWindow"),
      cmd("Open File…", "openFile", "o"),
      .separator(),
      cmd("Open Command Bar", "focusCommandBar", "l"),
      cmd("Open Command Bar", "focusCommandBar", functionKey(NSF5FunctionKey), .control).hiddenShortcut(),
      .separator(),
      closeWindow,
      cmd("Close Tab", "closeTab", "w"),
      cmd("Close All Tabs", "closeAllTabs", "k", [.command, .shift]),
      cmd("Clean Up Tabs", "cleanUpTabs", "k", [.command, .option]),
      .separator(),
      cmd("Save Page As…", "savePage"),
      sub("Share", [], menu: shareMenu),
      cmd("Email Page Location", "emailPageLocation", "i", [.command, .shift]),
      cmd("Print…", "print", "p"),
      cmd("Print Using System Dialog…", "printWithSystemDialog", "p", [.command, .option]),
    ])

    let paste = std("Paste and Match Style", #selector(MenuTarget.pasteAndMatchStyle(_:)), "v", [.command, .shift])
    paste.target = MenuTarget.shared
    let edits = [
      std("Cut", #selector(NSText.cut(_:)), "x"), std("Copy", #selector(NSText.copy(_:)), "c"),
      std("Paste", #selector(NSText.paste(_:)), "v"), std("Select All", #selector(NSText.selectAll(_:)), "a"),
    ]
    edits.forEach { $0.target = MenuTarget.shared }
    let undo = std("Undo", MenuTarget.undoAction, "z")
    Self.undo = undo
    _ = top("Edit", [
      undo,
      std("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      edits[0],
      edits[1],
      cmd("Copy URL", "copyUrl", "c", [.command, .shift]),
      cmd("Copy URL as Markdown", "copyUrlAsMarkdown", "c", [.command, .option, .shift]),
      edits[2],
      paste,
      std("Delete", #selector(NSText.delete(_:))),
      edits[3],
      .separator(),
      sub("Find", [
        cmd("Find…", "findInPage", "f"),
        cmd("Find and Replace…", "findAndReplace", "f", [.command, .option]),
        cmd("Find Next", "findNext", "g"),
        cmd("Find Previous", "findPrevious", "g", [.command, .shift]),
        cmd("Use Selection for Find", "useSelectionForFind", "e"),
        cmd("Jump to Selection", "jumpToSelection", "j"),
      ]),
      sub("Spelling and Grammar", [
        std("Show Spelling and Grammar", #selector(NSText.showGuessPanel(_:)), ":"),
        std("Check Document Now", #selector(NSText.checkSpelling(_:)), ";"),
        .separator(),
        std("Check Spelling While Typing", #selector(NSTextView.toggleContinuousSpellChecking(_:))),
        std("Check Grammar With Spelling", #selector(NSTextView.toggleGrammarChecking(_:))),
        std("Correct Spelling Automatically", #selector(NSTextView.toggleAutomaticSpellingCorrection(_:))),
      ]),
      sub("Substitutions", [
        std("Show Substitutions", #selector(NSTextView.orderFrontSubstitutionsPanel(_:))),
        .separator(),
        std("Smart Copy/Paste", #selector(NSTextView.toggleSmartInsertDelete(_:))),
        std("Smart Quotes", #selector(NSTextView.toggleAutomaticQuoteSubstitution(_:))),
        std("Smart Dashes", #selector(NSTextView.toggleAutomaticDashSubstitution(_:))),
        std("Smart Links", #selector(NSTextView.toggleAutomaticLinkDetection(_:))),
        std("Data Detectors", #selector(NSTextView.toggleAutomaticDataDetection(_:))),
        std("Text Replacement", #selector(NSTextView.toggleAutomaticTextReplacement(_:))),
      ]),
      sub("Transformations", [
        std("Make Upper Case", #selector(NSResponder.uppercaseWord(_:))),
        std("Make Lower Case", #selector(NSResponder.lowercaseWord(_:))),
        std("Capitalize", #selector(NSResponder.capitalizeWord(_:))),
      ]),
      sub("Speech", [
        std("Start Speaking", #selector(NSTextView.startSpeaking(_:))),
        std("Stop Speaking", #selector(NSTextView.stopSpeaking(_:))),
      ]),
      sub("AutoFill", [
        cmd("Contact…", "autofill", arg: "contact"),
        cmd("Passwords…", "autofill", arg: "passwords"),
        cmd("Credit Card…", "autofill", arg: "creditCard"),
      ]),
    ])

    let fullScreen = std("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", .function)
    let fullScreenAlias = std("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
    fullScreenAlias.isHidden = true
    fullScreenAlias.allowsKeyEquivalentWhenHidden = true
    _ = top("View", [
      sub("Appearance", [
        cmd("Automatic", "setAppearance", arg: "auto"),
        cmd("Light", "setAppearance", arg: "light"),
        cmd("Dark", "setAppearance", arg: "dark"),
      ]),
      cmd("Stop", "stop", "."),
      cmd("Refresh", "reload", "r"),
      cmd("Force Refresh the Page", "forceReload", "r", [.command, .shift]).alternate(),
      .separator(),
      cmd("Show Tabs in Sidebar", "toggleTabLayout", "s", [.command, .shift]),
      cmd("Auto-Hide Tabs", "toggleSidebar", "s"),
      cmd("Auto-Hide Tabs", "toggleSidebar", "l", [.command, .shift]).hiddenShortcut(),
      cmd("Auto-Hide Tabs", "toggleSidebar", "f", [.command, .shift]).hiddenShortcut(),
      .separator(),
      cmd("Open Split Pane", "openSplitPane", "=", [.control, .shift]),
      cmd("Focus Next Split Pane", "focusNextPane", "]", [.control, .shift]),
      cmd("Focus Previous Split Pane", "focusPreviousPane", "[", [.control, .shift]),
      cmd("Open Split Pane", "openSplitPane", "+", .control).hiddenShortcut(),
      cmd("Focus Next Split Pane", "focusNextPane", "}", .control).hiddenShortcut(),
      cmd("Focus Previous Split Pane", "focusPreviousPane", "{", .control).hiddenShortcut(),
      .separator(),
      sub("Show Bookmarks Bar", [
        cmd("Always", "setBookmarksBar", arg: "always"),
        cmd("On New Tab Only", "setBookmarksBar", arg: "newTab"),
        cmd("Never", "setBookmarksBar", arg: "never"),
        .separator(),
        cmd("Toggle Bookmarks Bar", "toggleBookmarksBar", "b", [.command, .shift]),
      ]),
      .separator(),
      cmd("Show Full URL", "toggleFullUrl"),
      cmd("Show Address Bar in Sidebar", "toggleAddressBar"),
      cmd("Cast…", "cast"),
      .separator(),
      cmd("Zoom to Actual Size", "zoomReset", "0"),
      cmd("Zoom In", "zoomIn", "+"),
      cmd("Zoom In", "zoomIn", "=").hiddenShortcut(),
      cmd("Zoom Out", "zoomOut", "-"),
      .separator(),
      fullScreen,
      fullScreenAlias,
      .separator(),
      sub("Developer", [
        cmd("View Source", "viewSource", "u", [.command, .option]),
        cmd("Developer Tools", "devTools", "i", [.command, .option]),
        cmd("Inspect Elements", "inspectElements", "c", [.command, .option]),
        cmd("JavaScript Console", "javaScriptConsole", "j", [.command, .option]),
        cmd("Allow JavaScript from Apple Events", "toggleJavaScriptFromAppleEvents"),
        cmd("Toggle Developer Tools", "toggleDevTools", functionKey(NSF12FunctionKey), []).hiddenShortcut(),
        cmd("Caret Browsing", "caretBrowsing", functionKey(NSF7FunctionKey), []).hiddenShortcut(),
      ]),
    ])

    let selectTab = (1...8).map { cmd("Select Tab \($0)", "selectTab", arg: "\($0)", "\($0)").hiddenShortcut() }
    _ = top("Tabs", [
      cmd("Go Back", "back", "["),
      cmd("Go Forward", "forward", "]"),
      cmd("Go Back", "back", leftArrow).hiddenShortcut(),
      cmd("Go Forward", "forward", rightArrow).hiddenShortcut(),
      .separator(),
      cmd("Next Tab", "nextTab", "]", [.command, .shift]),
      cmd("Previous Tab", "previousTab", "[", [.command, .shift]),
      cmd("Next Tab", "nextTab", "}").hiddenShortcut(),
      cmd("Previous Tab", "previousTab", "{").hiddenShortcut(),
      cmd("Next Tab", "nextTab", functionKey(NSRightArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Previous Tab", "previousTab", functionKey(NSLeftArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Next Tab", "nextTab", functionKey(NSPageDownFunctionKey), .control).hiddenShortcut(),
      cmd("Previous Tab", "previousTab", functionKey(NSPageUpFunctionKey), .control).hiddenShortcut(),
      cmd("Next Tab", "nextTab", functionKey(NSDownArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Previous Tab", "previousTab", functionKey(NSUpArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Move Tab Down", "moveTabDown", functionKey(NSPageDownFunctionKey), [.control, .shift]).hiddenShortcut(),
      cmd("Move Tab Up", "moveTabUp", functionKey(NSPageUpFunctionKey), [.control, .shift]).hiddenShortcut(),
      cmd("Search Tabs…", "searchTabs", "a", [.command, .shift]),
      cmd("Tab Switcher (forward)", "tabSwitcher", arg: "forward", "\t", .control).hiddenShortcut(),
      cmd("Tab Switcher (backward)", "tabSwitcher", arg: "backward", "\t", [.control, .shift]).hiddenShortcut(),
      cmd("Back to Pinned URL", "returnToPinnedUrl", "\r").hiddenShortcut(),
    ] + selectTab + [
      cmd("Select Last Tab", "selectLastTab", "9").hiddenShortcut(),
      .separator(),
      cmd("Move to Top Apps", "togglePin"),
      cmd("Move Pinned Tab to Top Apps", "togglePin", arg: "tile").hiddenWhenDisabled(),
      cmd("Move to Pinned", "togglePinnedRow", "d", [.command, .option, .shift]),
      cmd("Duplicate", "duplicateTab"),
      cmd("New Group with Tab", "newGroupWithTabs", "n", [.command, .control]),
      cmd("New Group with Tab", "newGroupWithTabs", "p", [.command, .control]).hiddenShortcut(),
      cmd("New Tab in Group", "newTabInGroup", "c", [.command, .control]).hiddenShortcut(),
      cmd("Close Group", "closeTabGroup", "w", [.command, .control]).hiddenShortcut(),
      .separator(),
      sub("Move to Profile", [], menu: moveToProfile),
      sub("Move to Window", [], menu: moveToWindow),
      .separator(),
      cmd("Add to Bookmarks…", "bookmarkPage", "d"),
      sub("Add Bookmark to Folder", [], menu: bookmarkToFolder),
      .separator(),
      cmd("Rename…", "renameTab"),
      cmd("Change Icon…", "changeTabIcon"),
      cmd("Mute Site", "toggleMute"),
    ])

    bookmarks = top("Bookmarks", [
      cmd("Bookmark This Page", "bookmarkPage", "d"),
      cmd("Bookmark All Tabs…", "bookmarkAllTabs", "d", [.command, .shift]),
      cmd("Manage Bookmarks", "manageBookmarks", "b", [.command, .option]),
    ])
    bookmarksFixedCount = bookmarks.items.count
    history = top("History", [])
    extensions = top("Extensions", [])

    profilesItem = sub("Profiles", [], menu: profiles)
    let minimizeAll = std("Minimize All", #selector(NSApplication.miniaturizeAll(_:)), "m", [.command, .option])
    let arrange = std("Arrange in Front", #selector(MenuTarget.arrangeWindowsInFront(_:)))
    arrange.target = MenuTarget.shared
    let keepOnTop = std("Keep Window on Top", #selector(MenuTarget.toggleKeepOnTop(_:)))
    keepOnTop.target = MenuTarget.shared
    minimizeAll.isAlternate = true
    let windowMenu = top("Window", [
      std("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      minimizeAll,
      std("Zoom", #selector(NSWindow.performZoom(_:))),
      arrange,
      keepOnTop,
      .separator(),
      cmd("Downloads", "downloads", "j", [.command, .shift]),
      cmd("Downloads", "downloads", "l", [.command, .option]).hiddenShortcut(),
      CommandItem("Task Manager", "taskManager", key: ""),
      cmd("Merge All Windows", "mergeAllWindows"),
      profilesSeparator,
      profilesItem,
      cmd("Show Profiles Menu", "openProfileMenu", "m", [.command, .shift]).hiddenShortcut(),
    ])
    NSApp.windowsMenu = windowMenu

    NSApp.helpMenu = top("Help", helpItems())

    built = nil
    refresh()
    return main
  }

  static func keyEquivalent(_ key: String, _ mods: NSEvent.ModifierFlags) -> (key: String, mods: NSEvent.ModifierFlags) {
    guard mods.contains(.shift), key.count == 1, let scalar = key.unicodeScalars.first, ("a"..."z").contains(scalar) else {
      return (key, mods)
    }
    return (key.uppercased(), mods.subtracting(.shift))
  }

  private static func shortcut(of item: NSMenuItem) -> (key: String, mods: NSEvent.ModifierFlags) {
    let key = item.keyEquivalent
    guard key.count == 1, key != key.lowercased() else { return (key, item.keyEquivalentModifierMask) }
    return (key.lowercased(), item.keyEquivalentModifierMask.union(.shift))
  }

  private static func switcherItems() -> [CommandItem] {
    var items: [CommandItem] = []
    walk(NSApp.mainMenu) { item, _ in
      if let item = item as? CommandItem, item.command == "tabSwitcher", !item.keyEquivalent.isEmpty { items.append(item) }
    }
    return items
  }

  static func heldModifiers(of item: NSMenuItem) -> NSEvent.ModifierFlags {
    let mods = shortcut(of: item).mods
    let held = mods.intersection([.control, .option, .command])
    return held.isEmpty ? mods.intersection(.shift) : held
  }

  static func isSwitcherKey(_ event: NSEvent) -> Bool {
    var key = (event.charactersIgnoringModifiers ?? "").lowercased()
    if key == "\u{19}" { key = "\t" }
    let mods = event.modifierFlags.intersection([.control, .option, .command, .shift])
    return switcherItems().contains { item in
      let combo = shortcut(of: item)
      return combo.key.lowercased() == key && combo.mods.intersection([.control, .option, .command]) == mods.subtracting(.shift)
    }
  }

  private static func functionKey(_ key: Int) -> String { String(Character(UnicodeScalar(UInt16(key))!)) }
  static let leftArrow = functionKey(NSLeftArrowFunctionKey), rightArrow = functionKey(NSRightArrowFunctionKey)
  private static let caretArrows: Set<String> = [
    leftArrow, rightArrow, functionKey(NSUpArrowFunctionKey), functionKey(NSDownArrowFunctionKey),
  ]

  static func movesCaret(_ item: NSMenuItem) -> Bool {
    let mods = item.keyEquivalentModifierMask.intersection([.command, .shift, .option, .control])
    return caretArrows.contains(item.keyEquivalent) && (mods == .command || mods == [.command, .shift])
  }

  static func editsText(_ responder: NSResponder?) -> Bool {
    if responder is NSText { return true }
    let textInputType = NSSelectorFromString("textInputType")
    guard let page = responder, FocusHandoff.isPage(page), page.responds(to: textInputType) else { return false }
    typealias Getter = @convention(c) (AnyObject, Selector) -> Int32
    return unsafeBitCast(page.method(for: textInputType), to: Getter.self)(page, textInputType) != 0
  }

  private static func aboutItem(_ title: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: #selector(AppUpdater.showAbout(_:)), keyEquivalent: "")
    item.target = AppUpdater.shared
    return item
  }

  private static func updatesItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Check for Updates…", action: #selector(AppUpdater.checkForUpdates(_:)), keyEquivalent: "")
    item.target = AppUpdater.shared
    item.isHidden = !AppUpdater.shared.isAvailable
    return item
  }

  private static func videoTourItem() -> NSMenuItem {
    let item = CommandItem("Video Tour", "videoTour", key: "")
    let url = Bundle.main.object(forInfoDictionaryKey: "ACVideoTourURL") as? String ?? ""
    item.isHidden = URL(string: url)?.scheme?.hasPrefix("http") != true
    return item
  }

  private static func releaseNotesItem() -> NSMenuItem {
    let item = CommandItem("Release Notes", "releaseNotes", key: "")
    let url = Bundle.main.object(forInfoDictionaryKey: "ACReleaseNotesURL") as? String ?? ""
    item.isHidden = URL(string: url)?.scheme?.hasPrefix("http") != true
    return item
  }

  private static func helpItems() -> [NSMenuItem] {
    var items: [NSMenuItem] = [
      CommandItem("Send Feedback…", "sendFeedback", key: "i", [.command, .option, .shift]),
      CommandItem("Keyboard Shortcuts", "keyboardShortcuts", key: ""),
      CommandItem("Tool Tour", "toolTour", key: ""),
      videoTourItem(),
      releaseNotesItem(),
      .separator(),
      CommandItem("Copy Diagnostics", "copyDiagnostics", key: ""),
      CommandItem("Record Performance Issue…", "recordPerformanceIssue", key: ""),
    ]
    #if DEBUG
    items += [.separator(), CommandItem("Show Onboarding", "showOnboarding", key: "")]
    #endif
    return items
  }

  private static func extensionIcon(_ dataURL: String?) -> NSImage? {
    guard let dataURL, let comma = dataURL.firstIndex(of: ",") else { return nil }
    if let cached = extensionIcons[dataURL] { return cached }
    guard let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
      let image = NSImage(data: data)
    else { return nil }
    image.size = NSSize(width: 16, height: 16)
    extensionIcons[dataURL] = image
    return image
  }

  private static var built: (profiles: [MenuState.Entry], windows: [MenuState.Entry], bookmarks: Int?,
                             extensions: [String], history: [[MenuState.Entry]])?

  static func refresh() {
    let state = MenuState.current
    let last = built
    let extensionKeys = state.extensions.map { "\($0.id)|\($0.title)|\($0.icon ?? "")" }
    let history = [state.recentlyClosed, state.recentlyClosedGroups]
    built = (state.profiles, state.windows, state.bookmarksRevision, extensionKeys, history)
    if last?.profiles != state.profiles { buildProfileMenus(state) }
    if last?.windows != state.windows { buildMoveToWindow(state) }
    if state.bookmarksRevision == nil || last?.bookmarks != state.bookmarksRevision { buildBookmarkMenus(state) }
    if last?.extensions != extensionKeys { buildExtensions(state) }
    if last?.history != history { buildHistory(state) }
    if let undo, (undo.target != nil) != state.undoReopensClosedTab {
      undo.target = state.undoReopensClosedTab ? MenuTarget.shared : nil
      undo.title = undo.defaultTitle
    }
    applyShortcuts(state.shortcuts)
  }

  private static func buildProfileMenus(_ state: MenuState) {
    moveToProfile.removeAllItems()
    for p in state.profiles {
      let item = CommandItem(p.title, "moveTabToProfile", arg: p.id)
      item.tracksChecked = false
      item.state = p.current ? .on : .off
      moveToProfile.addItem(item)
    }
    moveToProfile.addItem(.separator())
    moveToProfile.addItem(CommandItem("New Profile…", "moveTabToProfile", arg: "new"))

    profiles.removeAllItems()
    profilesItem.isHidden = state.profiles.count < 2
    profilesSeparator.isHidden = profilesItem.isHidden
    for (i, p) in state.profiles.enumerated() {
      let item = CommandItem(p.title, "switchProfile", arg: p.id, key: i < 9 ? "\(i + 1)" : "", .control)
      item.tracksChecked = false
      item.state = p.current ? .on : .off
      profiles.addItem(item)
      let newWindow = CommandItem("\(p.title) ↗", "newWindow", arg: p.id, key: "", []).commandAlternate(of: item)
      newWindow.tracksChecked = false
      profiles.addItem(newWindow)
    }
    profiles.addItem(.separator())
    profiles.addItem(CommandItem("Next Profile", "nextProfile"))
    profiles.addItem(CommandItem("Previous Profile", "previousProfile"))
    profiles.addItem(.separator())
    profiles.addItem(CommandItem("New Profile…", "newProfile"))

    littleArdiaInProfile.removeAllItems()
    littleArdiaInProfileItem.isHidden = state.profiles.count < 2
    for p in state.profiles { littleArdiaInProfile.addItem(CommandItem(p.title, "newLittleArdia", arg: p.id)) }
  }

  private static func buildMoveToWindow(_ state: MenuState) {
    moveToWindow.removeAllItems()
    for w in state.windows { moveToWindow.addItem(CommandItem(w.title, "moveTabToWindow", arg: w.id)) }
    if !state.windows.isEmpty { moveToWindow.addItem(.separator()) }
    moveToWindow.addItem(CommandItem("New Window", "moveTabToWindow", arg: "new"))
  }

  private static func buildBookmarkMenus(_ state: MenuState) {
    bookmarkToFolder.removeAllItems()
    for f in state.bookmarkFolders { bookmarkToFolder.addItem(CommandItem(f.title, "addBookmarkToFolder", arg: f.id)) }
    bookmarkToFolder.addItem(.separator())
    bookmarkToFolder.addItem(CommandItem("New Folder…", "addBookmarkToFolder", arg: "new"))

    while bookmarks.items.count > bookmarksFixedCount { bookmarks.removeItem(at: bookmarksFixedCount) }
    bookmarks.addItem(.separator())
    if !state.recentBookmarks.isEmpty {
      let header = NSMenuItem(title: "Recent Bookmarks", action: nil, keyEquivalent: "")
      header.isEnabled = false
      bookmarks.addItem(header)
      addBookmarks(state.recentBookmarks, to: bookmarks)
      bookmarks.addItem(.separator())
    }
    bookmarks.addItem(folderItem("Bookmarks Bar", state.bookmarksBar, holdsArcHolders: true))
    bookmarks.addItem(folderItem("Other Bookmarks", state.otherBookmarks))
  }

  private static func buildExtensions(_ state: MenuState) {
    extensions.removeAllItems()
    for ext in state.extensions {
      let item = CommandItem(ext.title, "openExtension", arg: ext.id)
      item.image = extensionIcon(ext.icon)
      extensions.addItem(item)
    }
    if !state.extensions.isEmpty { extensions.addItem(.separator()) }
    extensions.addItem(CommandItem("Add Extension…", "addExtension"))
    extensions.addItem(CommandItem("Manage Extensions…", "manageExtensions"))
    extensions.addItem(CommandItem("Pin Extensions…", "pinExtensions"))
  }

  private static func buildHistory(_ state: MenuState) {
    history.removeAllItems()
    history.addItem(CommandItem("Show History…", "showHistory", key: "y"))
    history.addItem(CommandItem("Clear Browsing Data…", "clearBrowsingData", key: "\u{8}", [.command, .shift]))
    history.addItem(.separator())
    let header = NSMenuItem(title: "Recently Closed", action: nil, keyEquivalent: "")
    header.isEnabled = false
    history.addItem(header)
    for entry in state.recentlyClosed { history.addItem(CommandItem(entry.title, "restoreClosed", arg: entry.id)) }
    if state.recentlyClosed.isEmpty { history.addItem(emptyItem()) }
    if !state.recentlyClosedGroups.isEmpty {
      history.addItem(.separator())
      let groupsHeader = NSMenuItem(title: "Recently Closed Groups", action: nil, keyEquivalent: "")
      groupsHeader.isEnabled = false
      history.addItem(groupsHeader)
      for entry in state.recentlyClosedGroups { history.addItem(CommandItem(entry.title, "restoreClosed", arg: entry.id)) }
    }
  }

  private static let modifierNames: [(String, NSEvent.ModifierFlags)] = [
    ("control", .control), ("option", .option), ("shift", .shift), ("command", .command), ("function", .function),
  ]
  private static let dynamicCommands: Set<String> = [
    "openBookmark", "restoreClosed", "moveTabToProfile", "moveTabToWindow", "addBookmarkToFolder",
    "addFolderToSidebar", "restoreArcFolders",
  ]

  private static func walk(_ menu: NSMenu?, path: [String] = [], _ visit: (NSMenuItem, [String]) -> Void) {
    for item in menu?.items ?? [] where !item.isSeparatorItem {
      if let submenu = item.submenu {
        if submenu !== NSApp.servicesMenu { walk(submenu, path: path + [item.title], visit) }
      } else {
        visit(item, path)
      }
    }
  }

  private static func modifiers(_ names: some Sequence<String>) -> NSEvent.ModifierFlags {
    let names = Set(names)
    return NSEvent.ModifierFlags(modifierNames.filter { names.contains($0.0) }.map(\.1))
  }

  static func comboKey(_ key: String, _ mods: NSEvent.ModifierFlags) -> String {
    let relevant = mods.intersection([.control, .option, .shift, .command, .function])
    let shift: NSEvent.ModifierFlags = key != key.lowercased() ? .shift : []
    return "\(key.lowercased())|\(relevant.union(shift).rawValue)"
  }

  private struct ShortcutGroup {
    var primary: Rebindable
    var path: [String]
    var items: [Rebindable]
  }

  private static func shortcutGroups() -> [(id: String, group: ShortcutGroup)] {
    var order: [String] = []
    var groups: [String: ShortcutGroup] = [:]
    walk(NSApp.mainMenu) { item, path in
      guard let item = item as? Rebindable, (item as? CommandItem)?.commandAlternateOf == nil else { return }
      let id = item.shortcutId
      if var group = groups[id] {
        group.items.append(item)
        if group.primary.isHidden && !item.isHidden { group.primary = item; group.path = path }
        groups[id] = group
      } else {
        order.append(id)
        groups[id] = ShortcutGroup(primary: item, path: path, items: [item])
      }
    }
    return order.map { ($0, groups[$0]!) }
  }

  private static func setShortcut(_ item: NSMenuItem, _ key: String, _ mods: NSEvent.ModifierFlags) {
    let shortcut = keyEquivalent(key, key.isEmpty ? [] : mods)
    if item.keyEquivalent != shortcut.key { item.keyEquivalent = shortcut.key }
    if item.keyEquivalentModifierMask != shortcut.mods { item.keyEquivalentModifierMask = shortcut.mods }
  }

  private static var announcedShortcuts: [String]?

  private static func announceShortcuts() {
    guard MenuState.current.fromApp else { return }
    var bound: [String] = []
    walk(NSApp.mainMenu) { item, _ in
      if item is Rebindable { bound.append("\(item.identifier?.rawValue ?? "")=\(item.keyEquivalent)|\(item.keyEquivalentModifierMask.rawValue)") }
    }
    if bound != announcedShortcuts {
      announcedShortcuts = bound
      NotificationCenter.default.post(name: .init("ArdiaMenuShortcutsChanged"), object: nil)
    }
  }

  private static func applyShortcuts(_ overrides: [String: [String]]) {
    defer { announceShortcuts() }
    let groups = shortcutGroups()
    let liveIds = Set(groups.map(\.id))
    let taken = Set(overrides.compactMap { id, o -> String? in
      guard liveIds.contains(id), let key = o.first, !key.isEmpty else { return nil }
      return comboKey(key, modifiers(o.dropFirst()))
    })
    for (id, group) in groups {
      let carriesOverride: (Rebindable) -> Bool = { $0 === group.primary || !$0.isHidden }
      for item in group.items {
        if let o = overrides[id] {
          if carriesOverride(item) { setShortcut(item, o.first ?? "", modifiers(o.dropFirst())) } else { setShortcut(item, "", []) }
        } else if !item.defaultKey.isEmpty, taken.contains(comboKey(item.defaultKey, item.defaultModifiers)) {
          setShortcut(item, "", [])
        } else {
          setShortcut(item, item.defaultKey, item.defaultModifiers)
        }
      }
    }
    var bound = Set<String>()
    walk(NSApp.mainMenu) { item, _ in
      guard !item.keyEquivalent.isEmpty, (item as? CommandItem)?.commandAlternateOf == nil else { return }
      bound.insert(comboKey(item.keyEquivalent, item.keyEquivalentModifierMask))
    }
    for case let item as CommandItem in profiles.items { item.followPrimaryShortcut(bound: bound) }
  }

  static func shortcutList() -> [[String: Any]] {
    var list: [[String: Any]] = []
    func names(_ mods: NSEvent.ModifierFlags) -> [String] {
      modifierNames.filter { mods.contains($0.1) }.map(\.0)
    }
    for (id, group) in shortcutGroups() {
      let item = group.primary
      if let command = item as? CommandItem, dynamicCommands.contains(command.command) { continue }
      guard !item.defaultTitle.isEmpty else { continue }
      let current = shortcut(of: item)
      let defaultCombo = comboKey(item.defaultKey, item.defaultModifiers)
      var aliases: [[String]] = []
      var seen: Set<String> = [defaultCombo]
      for other in group.items where other !== item && !other.defaultKey.isEmpty {
        if seen.insert(comboKey(other.defaultKey, other.defaultModifiers)).inserted {
          aliases.append([other.defaultKey] + names(other.defaultModifiers))
        }
      }
      list.append([
        "id": id, "title": item.defaultTitle, "path": group.path, "key": current.key,
        "modifiers": current.key.isEmpty ? [] : names(current.mods), "defaultKey": item.defaultKey,
        "defaultModifiers": item.defaultKey.isEmpty ? [] : names(item.defaultModifiers), "remappable": true,
        "aliases": aliases,
      ])
    }
    var seen = Set<String>()
    walk(NSApp.mainMenu) { item, path in
      guard !(item is Rebindable), !item.isHidden, !item.title.isEmpty, !item.keyEquivalent.isEmpty, item.action != nil else { return }
      let id = "system:" + (path + [item.title]).joined(separator: " > ")
      guard seen.insert(id).inserted else { return }
      let current = shortcut(of: item)
      let mods = names(current.mods)
      list.append([
        "id": id, "title": item.title, "path": path, "key": current.key, "modifiers": mods,
        "defaultKey": current.key, "defaultModifiers": mods, "remappable": false, "aliases": [[String]](),
      ])
    }
    return list
  }

  private static func emptyItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Empty", action: nil, keyEquivalent: "")
    item.isEnabled = false
    return item
  }

  private static func folderItem(_ title: String, _ children: [MenuState.Bookmark], id: String? = nil, holdsArcHolders: Bool = false, arcHolder: Bool = false) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let menu = NSMenu(title: title)
    addBookmarks(children, to: menu, holdsArcHolders: holdsArcHolders)
    if children.isEmpty { menu.addItem(emptyItem()) }
    if let id, hasGroupLinks(children) {
      menu.addItem(.separator())
      menu.addItem(CommandItem("Add to Sidebar as Group", "addFolderToSidebar", arg: id))
      if arcHolder && children.contains(where: { $0.children.map(hasGroupLinks) ?? false }) {
        menu.addItem(CommandItem("Restore Arc Folders as Groups", "restoreArcFolders", arg: id))
      }
    }
    item.submenu = menu
    item.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
    return item
  }

  private static func hasGroupLinks(_ nodes: [MenuState.Bookmark]) -> Bool {
    nodes.contains { node in
      if let children = node.children { return hasGroupLinks(children) }
      let url = (node.url ?? "").lowercased()
      return url.hasPrefix("http:") || url.hasPrefix("https:") || url.hasPrefix("file:")
    }
  }

  private static func addBookmarks(_ nodes: [MenuState.Bookmark], to menu: NSMenu, holdsArcHolders: Bool = false) {
    for node in nodes {
      if let children = node.children {
        menu.addItem(folderItem(node.title, children, id: node.id, arcHolder: holdsArcHolders && node.title.hasSuffix(" (Arc)")))
      } else {
        menu.addItem(CommandItem(node.title.isEmpty ? (node.url ?? "") : node.title, "openBookmark", arg: node.id))
      }
    }
  }

  static func dockMenu() -> NSMenu {
    let menu = NSMenu()
    let state = MenuState.current
    if state.profiles.count > 1 {
      for p in state.profiles {
        let item = CommandItem("New \(p.title) Window", "newWindow", arg: p.id)
        item.windowless = true
        menu.addItem(item)
      }
    } else {
      let item = CommandItem("New Window", "newWindow")
      item.windowless = true
      menu.addItem(item)
    }
    let incognito = CommandItem("New Incognito Window", "newIncognitoWindow")
    incognito.windowless = true
    menu.addItem(incognito)
    let small = CommandItem("New Little Ardia Window", "newLittleArdia")
    small.windowless = true
    menu.addItem(small)
    if state.profiles.count > 1 {
      let inProfile = NSMenu(title: "New Little Ardia Window in Profile")
      for p in state.profiles {
        let item = CommandItem(p.title, "newLittleArdia", arg: p.id)
        item.windowless = true
        inProfile.addItem(item)
      }
      let root = NSMenuItem(title: inProfile.title, action: nil, keyEquivalent: "")
      root.submenu = inProfile
      menu.addItem(root)
    }
    return menu
  }
}
