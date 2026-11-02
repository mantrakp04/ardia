import AppKit

enum CommandTable {
  enum Command: String {
    case newTab
    case newWindow
    case newIncognitoWindow
    case newLittleArdia
    case toggleOpenLinksInLittleArdia
    case reopenClosedTab
    case reopenClosedWindow
    case restoreClosed
    case focusCommandBar
    case closeTab
    case closeAllTabs
    case print
    case copyUrl
    case copyUrlAsMarkdown
    case findInPage
    case findNext
    case findPrevious
    case setAppearance
    case reload
    case forceReload
    case toggleTabLayout
    case toggleSidebar
    case openSplitPane
    case useSelectionForFind
    case findAndReplace
    case jumpToSelection
    case focusNextPane
    case focusPreviousPane
    case toggleFullUrl
    case toggleJavaScriptFromAppleEvents
    case toggleAddressBar
    case cast
    case zoomReset
    case zoomIn
    case zoomOut
    case devTools
    case toggleDevTools
    case javaScriptConsole
    case inspectElements
    case viewSource
    case back
    case forward
    case nextTab
    case previousTab
    case selectTab
    case selectLastTab
    case togglePin
    case togglePinnedRow
    case duplicateTab
    case moveTabToProfile
    case moveTabToWindow
    case bookmarkPage
    case addBookmarkToFolder
    case openBookmark
    case addFolderToSidebar
    case restoreArcFolders
    case toggleMute
    case togglePageEngine
    case downloads
    case mergeAllWindows
    case switchProfile
    case nextProfile
    case previousProfile
    case newProfile
    case openSettings
    case importBrowserData
    case showHistory
    case clearBrowsingData
    case manageBookmarks
    case exportBookmarks
    case bookmarkAllTabs
    case setBookmarksBar
    case toggleBookmarksBar
    case newTabInGroup
    case newGroupWithTabs
    case cleanUpTabs
    case tidyPins
    case searchTabs
    case renameTab
    case changeTabIcon
    case returnToPinnedUrl
    case tabSwitcher
    case share
    case sendFeedback
    case keyboardShortcuts
    case copyDiagnostics
    case recordPerformanceIssue
    case toolTour
    case videoTour
    case releaseNotes
    case showOnboarding
    case taskManager
    case openExtension
    case addExtension
    case manageExtensions
    case pinExtensions
    case autofill
    case openFile
    case savePage
    case emailPageLocation
    case printWithSystemDialog
    case stop
    case caretBrowsing
    case moveTabDown
    case moveTabUp
    case closeTabGroup
    case openProfileMenu
  }

  static let titles: [String: String] = [
    "newTab": "New Tab",
    "newWindow": "New Window",
    "newIncognitoWindow": "New Incognito Window",
    "newLittleArdia": "New Little Ardia Window",
    "toggleOpenLinksInLittleArdia": "Open Links from Other Apps in Main Window",
    "reopenClosedTab": "Reopen Closed Tab",
    "reopenClosedWindow": "Reopen Closed Window",
    "focusCommandBar": "Open Command Bar",
    "closeTab": "Close Tab",
    "closeAllTabs": "Close All Tabs",
    "print": "Print…",
    "copyUrl": "Copy URL",
    "copyUrlAsMarkdown": "Copy URL as Markdown",
    "findInPage": "Find…",
    "findNext": "Find Next",
    "findPrevious": "Find Previous",
    "setAppearance:auto": "Automatic",
    "setAppearance:light": "Light",
    "setAppearance:dark": "Dark",
    "reload": "Refresh",
    "forceReload": "Force Refresh the Page",
    "toggleTabLayout": "Show Tabs in Sidebar",
    "toggleSidebar": "Auto-Hide Tabs",
    "openSplitPane": "Open Split Pane",
    "useSelectionForFind": "Use Selection for Find",
    "findAndReplace": "Find and Replace…",
    "jumpToSelection": "Jump to Selection",
    "focusNextPane": "Focus Next Split Pane",
    "focusPreviousPane": "Focus Previous Split Pane",
    "toggleFullUrl": "Show Full URL",
    "toggleJavaScriptFromAppleEvents": "Allow JavaScript from Apple Events",
    "toggleAddressBar": "Show Address Bar in Sidebar",
    "cast": "Cast…",
    "zoomReset": "Zoom to Actual Size",
    "zoomIn": "Zoom In",
    "zoomOut": "Zoom Out",
    "devTools": "Developer Tools",
    "toggleDevTools": "Toggle Developer Tools",
    "javaScriptConsole": "JavaScript Console",
    "inspectElements": "Inspect Elements",
    "viewSource": "View Source",
    "back": "Go Back",
    "forward": "Go Forward",
    "nextTab": "Next Tab",
    "previousTab": "Previous Tab",
    "selectTab:1": "Select Tab 1",
    "selectTab:2": "Select Tab 2",
    "selectTab:3": "Select Tab 3",
    "selectTab:4": "Select Tab 4",
    "selectTab:5": "Select Tab 5",
    "selectTab:6": "Select Tab 6",
    "selectTab:7": "Select Tab 7",
    "selectTab:8": "Select Tab 8",
    "selectLastTab": "Select Last Tab",
    "togglePin": "Move to Top Apps",
    "togglePin:tile": "Move Pinned Tab to Top Apps",
    "togglePinnedRow": "Move to Pinned",
    "duplicateTab": "Duplicate",
    "bookmarkPage": "Add to Bookmarks…",
    "toggleMute": "Mute Tab",
    "togglePageEngine": "Open Page in WebKit",
    "downloads": "Downloads",
    "mergeAllWindows": "Merge All Windows",
    "nextProfile": "Next Profile",
    "previousProfile": "Previous Profile",
    "newProfile": "New Profile…",
    "openSettings": "Settings…",
    "importBrowserData": "Import from Another Browser…",
    "showHistory": "Show History…",
    "clearBrowsingData": "Clear Browsing Data…",
    "manageBookmarks": "Manage Bookmarks",
    "exportBookmarks": "Export Bookmarks…",
    "bookmarkAllTabs": "Bookmark All Tabs…",
    "setBookmarksBar:always": "Always",
    "setBookmarksBar:newTab": "On New Tab Only",
    "setBookmarksBar:never": "Never",
    "toggleBookmarksBar": "Toggle Bookmarks Bar",
    "newTabInGroup": "New Tab in Group",
    "newGroupWithTabs": "New Group with Tab",
    "cleanUpTabs": "Clean Up Tabs",
    "tidyPins": "Tidy Pins",
    "searchTabs": "Search Tabs…",
    "renameTab": "Rename…",
    "changeTabIcon": "Change Icon…",
    "returnToPinnedUrl": "Back to Pinned URL",
    "tabSwitcher:forward": "Tab Switcher (forward)",
    "tabSwitcher:backward": "Tab Switcher (backward)",
    "share": "Share",
    "sendFeedback": "Send Feedback…",
    "keyboardShortcuts": "Keyboard Shortcuts",
    "copyDiagnostics": "Copy Diagnostics",
    "recordPerformanceIssue": "Record Performance Issue…",
    "toolTour": "Tool Tour",
    "videoTour": "Video Tour",
    "releaseNotes": "Release Notes",
    "showOnboarding": "Show Onboarding",
    "taskManager": "Task Manager",
    "addExtension": "Add Extension…",
    "manageExtensions": "Manage Extensions…",
    "pinExtensions": "Pin Extensions…",
    "autofill:contact": "Contact…",
    "autofill:passwords": "Passwords…",
    "autofill:creditCard": "Credit Card…",
    "openFile": "Open File…",
    "savePage": "Save Page As…",
    "emailPageLocation": "Email Page Location",
    "printWithSystemDialog": "Print Using System Dialog…",
    "stop": "Stop",
    "caretBrowsing": "Caret Browsing",
    "moveTabDown": "Move Tab Down",
    "moveTabUp": "Move Tab Up",
    "closeTabGroup": "Close Group",
    "openProfileMenu": "Show Profiles Menu",
  ]

  static let keys: [String: [(key: String, mods: NSEvent.ModifierFlags)]] = [
    "newTab": [("t", [.command])],
    "newWindow": [("n", [.command])],
    "newIncognitoWindow": [("n", [.shift, .command])],
    "newLittleArdia": [("n", [.option, .command])],
    "reopenClosedTab": [("t", [.shift, .command])],
    "focusCommandBar": [("l", [.command]), ("\u{F708}", [.control])],
    "closeTab": [("w", [.command])],
    "closeAllTabs": [("k", [.shift, .command])],
    "print": [("p", [.command])],
    "copyUrl": [("c", [.shift, .command])],
    "copyUrlAsMarkdown": [("c", [.option, .shift, .command])],
    "findInPage": [("f", [.command])],
    "findNext": [("g", [.command])],
    "findPrevious": [("g", [.shift, .command])],
    "reload": [("r", [.command])],
    "forceReload": [("r", [.shift, .command])],
    "toggleTabLayout": [("s", [.shift, .command])],
    "toggleSidebar": [("s", [.command]), ("l", [.shift, .command]), ("f", [.shift, .command])],
    "openSplitPane": [("=", [.control, .shift]), ("+", [.control])],
    "useSelectionForFind": [("e", [.command])],
    "findAndReplace": [("f", [.option, .command])],
    "jumpToSelection": [("j", [.command])],
    "focusNextPane": [("]", [.control, .shift]), ("}", [.control])],
    "focusPreviousPane": [("[", [.control, .shift]), ("{", [.control])],
    "zoomReset": [("0", [.command])],
    "zoomIn": [("+", [.command]), ("=", [.command])],
    "zoomOut": [("-", [.command])],
    "devTools": [("i", [.option, .command])],
    "toggleDevTools": [("\u{F70F}", [])],
    "javaScriptConsole": [("j", [.option, .command])],
    "inspectElements": [("c", [.option, .command])],
    "viewSource": [("u", [.option, .command])],
    "back": [("[", [.command]), ("\u{F702}", [.command])],
    "forward": [("]", [.command]), ("\u{F703}", [.command])],
    "nextTab": [("]", [.shift, .command]), ("}", [.command]), ("\u{F703}", [.option, .command]), ("\u{F72D}", [.control]), ("\u{F701}", [.option, .command])],
    "previousTab": [("[", [.shift, .command]), ("{", [.command]), ("\u{F702}", [.option, .command]), ("\u{F72C}", [.control]), ("\u{F700}", [.option, .command])],
    "selectTab:1": [("1", [.command])],
    "selectTab:2": [("2", [.command])],
    "selectTab:3": [("3", [.command])],
    "selectTab:4": [("4", [.command])],
    "selectTab:5": [("5", [.command])],
    "selectTab:6": [("6", [.command])],
    "selectTab:7": [("7", [.command])],
    "selectTab:8": [("8", [.command])],
    "selectLastTab": [("9", [.command])],
    "togglePinnedRow": [("d", [.option, .shift, .command])],
    "bookmarkPage": [("d", [.command])],
    "downloads": [("j", [.shift, .command]), ("l", [.option, .command])],
    "openSettings": [(",", [.command])],
    "showHistory": [("y", [.command])],
    "clearBrowsingData": [("\u{8}", [.shift, .command])],
    "manageBookmarks": [("b", [.option, .command])],
    "bookmarkAllTabs": [("d", [.shift, .command])],
    "toggleBookmarksBar": [("b", [.shift, .command])],
    "newTabInGroup": [("t", [.option, .command]), ("c", [.control, .command])],
    "newGroupWithTabs": [("n", [.control, .command]), ("p", [.control, .command])],
    "cleanUpTabs": [("k", [.option, .command])],
    "searchTabs": [("a", [.shift, .command])],
    "returnToPinnedUrl": [("\u{D}", [.command])],
    "tabSwitcher:forward": [("\u{9}", [.control])],
    "tabSwitcher:backward": [("\u{9}", [.control, .shift])],
    "sendFeedback": [("i", [.option, .shift, .command])],
    "openFile": [("o", [.command])],
    "emailPageLocation": [("i", [.shift, .command])],
    "printWithSystemDialog": [("p", [.option, .command])],
    "stop": [(".", [.command])],
    "caretBrowsing": [("\u{F70A}", [])],
    "moveTabDown": [("\u{F72D}", [.control, .shift])],
    "moveTabUp": [("\u{F72C}", [.control, .shift])],
    "closeTabGroup": [("w", [.control, .command])],
    "openProfileMenu": [("m", [.shift, .command])],
    "std:quit:": [("q", [.command])],
    "std:hide:": [("h", [.command])],
    "std:hideOtherApplications:": [("h", [.option, .command])],
    "std:closeWindow:": [("w", [.shift, .command])],
    "std:undo:": [("z", [.command])],
    "std:redo:": [("z", [.shift, .command])],
    "std:cut:": [("x", [.command])],
    "std:copy:": [("c", [.command])],
    "std:paste:": [("v", [.command])],
    "std:pasteAndMatchStyle:": [("v", [.shift, .command])],
    "std:selectAll:": [("a", [.command])],
    "std:showGuessPanel:": [(":", [.command])],
    "std:checkSpelling:": [(";", [.command])],
    "std:toggleFullScreen:": [("f", [.function]), ("f", [.control, .command])],
    "std:performMiniaturize:": [("m", [.command])],
    "std:miniaturizeAll:": [("m", [.option, .command])],
  ]
}
