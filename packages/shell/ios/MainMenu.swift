import AppKit

enum MainMenu {
  private static var moveToProfile = NSMenu(title: "Move to Profile")
  private static var moveToWindow = NSMenu(title: "Move to Window")
  private static var bookmarkToFolder = NSMenu(title: "Add Bookmark to Folder")
  static var profiles = NSMenu(title: "Profiles")
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
      cmd("Open Page in WebKit", "togglePageEngine"),
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

  private static func aboutItem(_ title: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: #selector(AppUpdater.showAbout(_:)), keyEquivalent: "")
    item.target = AppUpdater.shared
    return item
  }

  private static func updatesItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Check for Updates…", action: #selector(AppUpdater.checkForUpdates(_:)), keyEquivalent: "")
    item.target = AppUpdater.shared
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
}
