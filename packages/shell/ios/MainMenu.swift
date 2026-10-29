import AppKit
import ArdiaCore

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

    func std(_ title: String, _ action: Selector) -> StandardItem { StandardItem(title, action) }
    func sub(_ title: String, _ items: [NSMenuItem], menu: NSMenu? = nil) -> NSMenuItem {
      let submenu = menu ?? NSMenu(title: title)
      submenu.autoenablesItems = true
      items.flatMap(withAliases).forEach(submenu.addItem)
      let root = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      root.submenu = submenu
      return root
    }
    func top(_ title: String, _ items: [NSMenuItem], menu: NSMenu? = nil) -> NSMenu {
      let item = sub(title, items, menu: menu)
      main.addItem(item)
      return item.submenu!
    }
    func cmd(_ command: CommandTable.Command, arg: String? = nil, title: String? = nil) -> CommandItem {
      CommandItem(command, arg: arg, title: title)
    }
    func hidden(_ command: CommandTable.Command, arg: String? = nil) -> CommandItem { cmd(command, arg: arg).hiddenShortcut() }

    let shareMenu = NSMenu(title: "Share")
    shareMenu.delegate = ShareMenu.shared

    let quit = std("Quit \(appName)", #selector(MenuTarget.quit(_:)))
    quit.target = MenuTarget.shared
    let closeWindow = std("Close Window", #selector(MenuTarget.closeWindow(_:)))
    closeWindow.target = MenuTarget.shared
    let services = NSMenu(title: "Services")
    NSApp.servicesMenu = services
    _ = top(appName, [
      aboutItem("About \(appName)"),
      updatesItem(),
      .separator(),
      cmd(.openSettings),
      cmd(.importBrowserData),
      .separator(),
      sub("Services", [], menu: services),
      .separator(),
      std("Hide \(appName)", #selector(NSApplication.hide(_:))),
      std("Hide Others", #selector(NSApplication.hideOtherApplications(_:))),
      std("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      quit,
    ])

    littleArdiaInProfileItem = sub("New Little Ardia Window in Profile", [], menu: littleArdiaInProfile)
    _ = top("File", [
      cmd(.newTab),
      cmd(.newTabInGroup),
      cmd(.newWindow),
      cmd(.newIncognitoWindow),
      cmd(.newLittleArdia),
      littleArdiaInProfileItem,
      cmd(.toggleOpenLinksInLittleArdia),
      cmd(.reopenClosedTab),
      cmd(.reopenClosedWindow),
      cmd(.openFile),
      .separator(),
      cmd(.focusCommandBar),
      .separator(),
      closeWindow,
      cmd(.closeTab),
      cmd(.closeAllTabs),
      cmd(.cleanUpTabs),
      .separator(),
      cmd(.savePage),
      sub("Share", [], menu: shareMenu),
      cmd(.emailPageLocation),
      cmd(.print),
      cmd(.printWithSystemDialog),
    ])

    let paste = std("Paste and Match Style", #selector(MenuTarget.pasteAndMatchStyle(_:)))
    paste.target = MenuTarget.shared
    let edits = [
      std("Cut", #selector(NSText.cut(_:))), std("Copy", #selector(NSText.copy(_:))),
      std("Paste", #selector(NSText.paste(_:))), std("Select All", #selector(NSText.selectAll(_:))),
    ]
    edits.forEach { $0.target = MenuTarget.shared }
    let undo = std("Undo", MenuTarget.undoAction)
    Self.undo = undo
    _ = top("Edit", [
      undo,
      std("Redo", Selector(("redo:"))),
      .separator(),
      edits[0],
      edits[1],
      cmd(.copyUrl),
      cmd(.copyUrlAsMarkdown),
      edits[2],
      paste,
      std("Delete", #selector(NSText.delete(_:))),
      edits[3],
      .separator(),
      sub("Find", [
        cmd(.findInPage),
        cmd(.findAndReplace),
        cmd(.findNext),
        cmd(.findPrevious),
        cmd(.useSelectionForFind),
        cmd(.jumpToSelection),
      ]),
      sub("Spelling and Grammar", [
        std("Show Spelling and Grammar", #selector(NSText.showGuessPanel(_:))),
        std("Check Document Now", #selector(NSText.checkSpelling(_:))),
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
        cmd(.autofill, arg: "contact"),
        cmd(.autofill, arg: "passwords"),
        cmd(.autofill, arg: "creditCard"),
      ]),
    ])

    _ = top("View", [
      sub("Appearance", [
        cmd(.setAppearance, arg: "auto"),
        cmd(.setAppearance, arg: "light"),
        cmd(.setAppearance, arg: "dark"),
      ]),
      cmd(.stop),
      cmd(.reload),
      cmd(.forceReload).alternate(),
      .separator(),
      cmd(.toggleTabLayout),
      cmd(.toggleSidebar),
      .separator(),
      cmd(.openSplitPane),
      cmd(.focusNextPane),
      cmd(.focusPreviousPane),
      .separator(),
      sub("Show Bookmarks Bar", [
        cmd(.setBookmarksBar, arg: "always"),
        cmd(.setBookmarksBar, arg: "newTab"),
        cmd(.setBookmarksBar, arg: "never"),
        .separator(),
        cmd(.toggleBookmarksBar),
      ]),
      .separator(),
      cmd(.toggleFullUrl),
      cmd(.toggleAddressBar),
      cmd(.cast),
      cmd(.togglePageEngine),
      .separator(),
      cmd(.zoomReset),
      cmd(.zoomIn),
      cmd(.zoomOut),
      .separator(),
      std("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:))),
      .separator(),
      sub("Developer", [
        cmd(.viewSource),
        cmd(.devTools),
        cmd(.inspectElements),
        cmd(.javaScriptConsole),
        cmd(.toggleJavaScriptFromAppleEvents),
        hidden(.toggleDevTools),
        hidden(.caretBrowsing),
      ]),
    ])

    _ = top("Tabs", [
      cmd(.back),
      cmd(.forward),
      .separator(),
      cmd(.nextTab),
      cmd(.previousTab),
      hidden(.moveTabDown),
      hidden(.moveTabUp),
      cmd(.searchTabs),
      hidden(.tabSwitcher, arg: "forward"),
      hidden(.tabSwitcher, arg: "backward"),
      hidden(.returnToPinnedUrl),
    ] + (1...8).map { hidden(.selectTab, arg: "\($0)") } + [
      hidden(.selectLastTab),
      .separator(),
      cmd(.togglePin),
      cmd(.togglePin, arg: "tile").hiddenWhenDisabled(),
      cmd(.togglePinnedRow),
      cmd(.duplicateTab),
      cmd(.newGroupWithTabs),
      hidden(.closeTabGroup),
      .separator(),
      sub("Move to Profile", [], menu: moveToProfile),
      sub("Move to Window", [], menu: moveToWindow),
      .separator(),
      cmd(.bookmarkPage),
      sub("Add Bookmark to Folder", [], menu: bookmarkToFolder),
      .separator(),
      cmd(.renameTab),
      cmd(.changeTabIcon),
      cmd(.toggleMute),
    ])

    bookmarks = top("Bookmarks", [
      cmd(.bookmarkPage, title: "Bookmark This Page"),
      cmd(.bookmarkAllTabs),
      cmd(.manageBookmarks),
      cmd(.exportBookmarks),
    ])
    bookmarksFixedCount = bookmarks.items.count
    history = top("History", [])
    extensions = top("Extensions", [])

    profilesItem = sub("Profiles", [], menu: profiles)
    let minimizeAll = std("Minimize All", #selector(NSApplication.miniaturizeAll(_:)))
    let arrange = std("Arrange in Front", #selector(MenuTarget.arrangeWindowsInFront(_:)))
    arrange.target = MenuTarget.shared
    let keepOnTop = std("Keep Window on Top", #selector(MenuTarget.toggleKeepOnTop(_:)))
    keepOnTop.target = MenuTarget.shared
    minimizeAll.isAlternate = true
    let windowMenu = top("Window", [
      std("Minimize", #selector(NSWindow.performMiniaturize(_:))),
      minimizeAll,
      std("Zoom", #selector(NSWindow.performZoom(_:))),
      arrange,
      keepOnTop,
      .separator(),
      cmd(.downloads),
      cmd(.taskManager),
      cmd(.mergeAllWindows),
      profilesSeparator,
      profilesItem,
      hidden(.openProfileMenu),
    ])
    NSApp.windowsMenu = windowMenu

    NSApp.helpMenu = top("Help", helpItems())

    built = nil
    refresh()
    return main
  }

  private static func withAliases(_ item: NSMenuItem) -> [NSMenuItem] {
    switch item {
    case let item as CommandItem: [item] + item.aliasItems()
    case let item as StandardItem: [item] + item.aliasItems()
    default: [item]
    }
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
    let item = CommandItem(.videoTour)
    let url = Bundle.main.object(forInfoDictionaryKey: "ACVideoTourURL") as? String ?? ""
    item.isHidden = URL(string: url)?.scheme?.hasPrefix("http") != true
    return item
  }

  private static func releaseNotesItem() -> NSMenuItem {
    let item = CommandItem(.releaseNotes)
    let url = Bundle.main.object(forInfoDictionaryKey: "ACReleaseNotesURL") as? String ?? ""
    item.isHidden = URL(string: url)?.scheme?.hasPrefix("http") != true
    return item
  }

  private static func helpItems() -> [NSMenuItem] {
    var items: [NSMenuItem] = [
      CommandItem(.sendFeedback),
      CommandItem(.keyboardShortcuts),
      CommandItem(.toolTour),
      videoTourItem(),
      releaseNotesItem(),
      .separator(),
      CommandItem(.copyDiagnostics),
      CommandItem(.recordPerformanceIssue),
    ]
    #if DEBUG
    items += [.separator(), CommandItem(.showOnboarding)]
    #endif
    return items
  }

  private static func extensionIcon(_ dataURL: String?) -> NSImage? {
    guard let dataURL else { return nil }
    if let cached = extensionIcons[dataURL] { return cached }
    guard let image = NSImage(dataURL: dataURL) else { return nil }
    image.size = NSSize(width: 16, height: 16)
    extensionIcons[dataURL] = image
    return image
  }

  private static var built: (profiles: [MenuEntry], windows: [MenuEntry], bookmarks: Int?,
                             extensions: [String], history: [[MenuEntry]])?

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

  private static func folderItem(_ title: String, _ children: [MenuBookmark], id: String? = nil, holdsArcHolders: Bool = false, arcHolder: Bool = false) -> NSMenuItem {
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

  private static func hasGroupLinks(_ nodes: [MenuBookmark]) -> Bool {
    nodes.contains { node in
      if let children = node.children { return hasGroupLinks(children) }
      let url = (node.url ?? "").lowercased()
      return url.hasPrefix("http:") || url.hasPrefix("https:") || url.hasPrefix("file:")
    }
  }

  private static func addBookmarks(_ nodes: [MenuBookmark], to menu: NSMenu, holdsArcHolders: Bool = false) {
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
    for p in state.profiles {
      let item = CommandItem(p.title, "switchProfile", arg: p.id)
      item.tracksChecked = false
      item.state = p.current ? .on : .off
      profiles.addItem(item)
      let newWindow = CommandItem("\(p.title) ↗", "newWindow", arg: p.id, key: "", []).commandAlternate(of: item)
      newWindow.tracksChecked = false
      profiles.addItem(newWindow)
    }
    profiles.addItem(.separator())
    profiles.addItem(CommandItem(.nextProfile))
    profiles.addItem(CommandItem(.previousProfile))
    profiles.addItem(.separator())
    profiles.addItem(CommandItem(.newProfile))

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
    for f in state.bookmarks.bookmarkFolders { bookmarkToFolder.addItem(CommandItem(f.title, "addBookmarkToFolder", arg: f.id)) }
    bookmarkToFolder.addItem(.separator())
    bookmarkToFolder.addItem(CommandItem("New Folder…", "addBookmarkToFolder", arg: "new"))

    while bookmarks.items.count > bookmarksFixedCount { bookmarks.removeItem(at: bookmarksFixedCount) }
    bookmarks.addItem(.separator())
    if !state.bookmarks.recentBookmarks.isEmpty {
      let header = NSMenuItem(title: "Recent Bookmarks", action: nil, keyEquivalent: "")
      header.isEnabled = false
      bookmarks.addItem(header)
      addBookmarks(state.bookmarks.recentBookmarks, to: bookmarks)
      bookmarks.addItem(.separator())
    }
    bookmarks.addItem(folderItem("Bookmarks Bar", state.bookmarks.bookmarksBar, holdsArcHolders: true))
    bookmarks.addItem(folderItem("Other Bookmarks", state.bookmarks.otherBookmarks))
  }

  private static func buildExtensions(_ state: MenuState) {
    extensions.removeAllItems()
    for ext in state.extensions {
      let item = CommandItem(ext.title, "openExtension", arg: ext.id)
      item.image = extensionIcon(ext.icon)
      extensions.addItem(item)
    }
    if !state.extensions.isEmpty { extensions.addItem(.separator()) }
    extensions.addItem(CommandItem(.addExtension))
    extensions.addItem(CommandItem(.manageExtensions))
    extensions.addItem(CommandItem(.pinExtensions))
  }

  private static func buildHistory(_ state: MenuState) {
    history.removeAllItems()
    history.addItem(CommandItem(.showHistory))
    history.addItem(CommandItem(.clearBrowsingData))
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
