import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct PinnedTileGrid: View {
  let width: CGFloat
  var space: SyncedProfile?
  @Environment(AppModel.self) private var app

  init(width: CGFloat, space: SyncedProfile? = nil) {
    self.width = width
    self.space = space
  }

  var body: some View {
    if let space = space ?? app.currentSpace, !space.pinned.tiles.isEmpty {
      let tiles = space.pinned.tiles
      let grid = SidebarMetrics.pinGrid(count: tiles.count, innerWidth: max(width, SidebarMetrics.Tile.minWidth), balanced: true)
      GlassBar {
        Grid(horizontalSpacing: SidebarMetrics.Tile.gap, verticalSpacing: SidebarMetrics.Tile.gap) {
          ForEach(Self.rows(of: tiles, columns: grid.columns), id: \.first?.key) { row in
            GridRow {
              ForEach(row) { tile in
                PinnedTileButton(tile: tile, spaceId: space.syncId)
                  .frame(width: grid.tileWidth, height: SidebarMetrics.Tile.height)
              }
            }
          }
        }
      }
      .frame(width: width, alignment: .leading)
    }
  }

  static func rows(of tiles: [PinnedTile], columns: Int) -> [[PinnedTile]] {
    stride(from: 0, to: tiles.count, by: max(columns, 1)).map { Array(tiles[$0..<min($0 + max(columns, 1), tiles.count)]) }
  }
}

private struct PinnedTileButton: View {
  let tile: PinnedTile
  let spaceId: String
  @Environment(AppModel.self) private var app

  var body: some View {
    Group {
      if let folder = tile.folder, !folder.isEmpty {
        Menu {
          folderPages(folder)
        } label: {
          face(isFolder: true)
            .glassControl(.tile)
        }
        .contextMenu { folderPages(folder) }
      } else {
        Button {
          open(tile.url, tile.title)
        } label: {
          face(isFolder: false)
        }
        .buttonStyle(.glassControl(.tile))
        .contextMenu { tileActions }
      }
    }
    .accessibilityLabel(Self.label(tile.title, tile.url))
  }

  private func folderPages(_ folder: [PinnedTab]) -> some View {
    ForEach(folder) { tab in
      Button {
        open(tab.url, tab.title)
      } label: {
        Label {
          Text(Self.label(tab.title, tab.url))
        } icon: {
          PinnedMark(mark: tab.mark, url: tab.url)
        }
      }
    }
  }

  @ViewBuilder private var tileActions: some View {
    Button("Open", systemImage: "arrow.up.forward.square") { open(tile.url, tile.title) }
    if let link = URL(string: tile.url) {
      Button("Copy Link", systemImage: "link") {
        app.web.copyLink(link)
        app.toasts.show(.copiedURLWithoutTrackers)
      }
      ShareLink(item: link, subject: Text(Self.label(tile.title, tile.url))) {
        Label("Share", systemImage: "square.and.arrow.up")
      }
    }
  }

  private func face(isFolder: Bool) -> some View {
    Group {
      if isFolder, tile.mark == nil {
        Image(systemName: "folder.fill")
          .font(Typography.body)
          .foregroundStyle(.secondary)
      } else {
        PinnedMark(mark: tile.mark, url: tile.url, size: SidebarMetrics.Row.icon)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .contentShape(.rect(cornerRadius: SidebarMetrics.Tile.radius))
  }

  private func open(_ url: String, _ title: String) {
    app.openRemote(url: url, title: title, profileSyncId: spaceId)
  }

  static func label(_ title: String, _ url: String) -> String {
    title.isEmpty ? (BrowserURL.host(of: url) ?? url) : title
  }
}
