import ArdiaDesign
import SwiftUI

struct BrowserCommands: Commands {
  let app: AppModel
  let sidebar: SidebarState

  var body: some Commands {
    CommandGroup(replacing: .appSettings) {
      item(.settings)
    }
    CommandGroup(replacing: .newItem) {
      item(.newTab)
      item(.newIncognitoTab)
      item(.reopenClosedTab)
      Divider()
      item(.openLocation)
      item(.closeTab)
    }
    CommandGroup(replacing: .printItem) {
      item(.copyLink)
      item(.share)
      item(.print)
    }
    CommandGroup(replacing: .textEditing) {
      item(.findInPage)
      item(.findNext)
      item(.findPrevious)
    }
    CommandGroup(replacing: .sidebar) {
      CommandItem(command: .toggleSidebar, title: sidebarTitle, isEnabled: CommandAvailability.allows(.toggleSidebar, in: front), performer: performer)
    }
    CommandGroup(before: .toolbar) {
      item(.reload)
      item(.stop)
      Divider()
      item(.zoomIn)
      item(.zoomOut)
      item(.actualSize)
    }
    CommandMenu(String(localized: "History")) {
      item(.back)
      item(.forward)
      Divider()
      item(.showHistory)
      item(.showBookmarks)
      item(.showDownloads)
    }
    CommandMenu(String(localized: "Tabs")) {
      item(.nextTab)
      item(.previousTab)
      Divider()
      ForEach(BrowserCommand.numberedTabs, id: \.self) { command in
        item(command)
      }
      Divider()
      item(.nextSpace)
      item(.previousSpace)
    }
  }

  @FocusedValue(\.sidebarContext) private var sidebarContext
  @FocusedValue(\.commandFront) private var publishedFront

  private var performer: CommandPerformer {
    CommandPerformer(app: app, sidebar: sidebar, context: sidebarContext)
  }

  private var front: CommandFront {
    var front = publishedFront ?? app.commandFront(sidebar: nil)
    front.canToggleSidebar = sidebarContext?.canToggle ?? false
    return front
  }

  private var sidebarTitle: String {
    guard let context = sidebarContext, let action = sidebar.toggleAction(layout: context.layout, hinge: context.hinge) else {
      return SidebarToggleAction.show.title
    }
    return action.title
  }

  private func item(_ command: BrowserCommand) -> CommandItem {
    CommandItem(command: command, title: command == .print ? PrintTitle.title(in: front) : command.title, isEnabled: CommandAvailability.allows(command, in: front), performer: performer)
  }
}

private struct CommandItem: View {
  let command: BrowserCommand
  let title: String
  let isEnabled: Bool
  let performer: CommandPerformer

  var body: some View {
    Button(title) { performer.perform(command) }
      .keyboardShortcut(command.primaryShortcut?.keyboardShortcut)
      .disabled(!isEnabled)
  }
}

struct AlternateShortcuts: View {
  let commands: [BrowserCommand]
  let context: SidebarContext?

  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar

  var body: some View {
    let performer = CommandPerformer(app: app, sidebar: sidebar, context: context)
    ZStack {
      ForEach(commands, id: \.self) { command in
        ForEach(command.shortcuts.dropFirst().compactMap(\.keyboardShortcut), id: \.self) { shortcut in
          Button(command.title) { performer.perform(command) }
            .keyboardShortcut(shortcut)
            .disabled(!performer.allows(command))
        }
      }
    }
    .frame(width: 0, height: 0)
    .opacity(0)
    .accessibilityHidden(true)
  }
}
