import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct PinnedTiles: View {
  let tiles: [PinnedTile]
  var perRow = TabsLayout.tilesPerRow
  let open: (_ url: String, _ title: String) -> Void

  var body: some View {
    let columns = max(1, min(perRow, tiles.count))
    Grid(horizontalSpacing: TabsLayout.tileGap, verticalSpacing: TabsLayout.tileGap) {
      ForEach(Array(stride(from: 0, to: tiles.count, by: columns)), id: \.self) { start in
        GridRow {
          ForEach(tiles[start..<min(start + columns, tiles.count)]) { tile in
            PinnedTileButton(tile: tile, open: open)
          }
          ForEach(0..<max(0, start + columns - tiles.count), id: \.self) { _ in
            Color.clear.frame(height: TabsLayout.tileHeight)
          }
        }
      }
    }
  }
}

private struct PinnedTileButton: View {
  let tile: PinnedTile
  let open: (_ url: String, _ title: String) -> Void

  var body: some View {
    if let folder = tile.folder, !folder.isEmpty {
      Menu {
        ForEach(folder) { tab in
          Button(tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title) { open(tab.url, tab.title) }
        }
      } label: {
        PinnedTileFace(tile: tile, isFolder: true)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(PinnedTileFace.label(for: tile))
      .accessibilityHint("Shows the folder’s tabs.")
    } else {
      Button { open(tile.url, tile.title) } label: {
        PinnedTileFace(tile: tile, isFolder: false)
      }
      .buttonStyle(PressableStyle())
      .accessibilityLabel(PinnedTileFace.label(for: tile))
      .contextMenu {
        if let link = URL(string: tile.url) {
          Button("Copy Link") { UIPasteboard.general.url = link }
          ShareLink("Share", item: link)
        }
      }
    }
  }
}

struct PinnedTileFace: View {
  let tile: PinnedTile
  let isFolder: Bool

  var body: some View {
    icon
      .accessibilityHidden(true)
      .frame(maxWidth: .infinity)
      .frame(height: TabsLayout.tileHeight)
      .contentShape(.rect(cornerRadius: TabsLayout.tileRadius, style: .continuous))
      .chromeSurface(in: .rect(cornerRadius: TabsLayout.tileRadius, style: .continuous))
  }

  @ViewBuilder
  private var icon: some View {
    if isFolder {
      Image(systemName: "folder.fill")
        .font(.system(size: TabsLayout.tileIcon * 0.95))
        .foregroundStyle(Palette.formAccent.opacity(0.55))
    } else if let symbol = SpaceColors.symbol(tile.icon) {
      Image(systemName: symbol)
        .font(.system(size: TabsLayout.tileIcon * 0.9, weight: .medium))
        .foregroundStyle(.secondary)
    } else if let emoji = SpaceGlyph.emoji(tile.icon) {
      Text(emoji)
        .font(.system(size: TabsLayout.tileIcon))
    } else {
      FaviconImage(iconURL: nil, pageURL: tile.url, size: TabsLayout.tileIcon)
    }
  }

  static func label(for tile: PinnedTile) -> String {
    tile.title.isEmpty ? (BrowserURL.host(of: tile.url) ?? tile.url) : tile.title
  }
}
