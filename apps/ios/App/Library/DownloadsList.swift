import ArdiaBrowser
import ArdiaDesign
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

struct DownloadedFile: Identifiable, Hashable {
  var url: URL
  var size: Int64
  var modified: Date

  var id: URL { url }
  var name: String { url.lastPathComponent }

  var symbol: String {
    guard let type = UTType(filenameExtension: url.pathExtension) else { return "doc" }
    if type.conforms(to: .image) { return "photo" }
    if type.conforms(to: .movie) || type.conforms(to: .video) { return "film" }
    if type.conforms(to: .audio) { return "waveform" }
    if type.conforms(to: .pdf) { return "doc.richtext" }
    if type.conforms(to: .archive) { return "doc.zipper" }
    return "doc"
  }
}

@MainActor
@Observable
final class DownloadsModel {
  private(set) var files: [DownloadedFile] = []
  private(set) var hasLoaded = false

  func reload(from directory: URL) {
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
    let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])) ?? []
    files = urls.compactMap { url in
      guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { return nil }
      return DownloadedFile(url: url, size: Int64(values.fileSize ?? 0), modified: values.contentModificationDate ?? .distantPast)
    }
    .sorted { $0.modified > $1.modified }
    hasLoaded = true
  }

  func delete(_ file: DownloadedFile) {
    try? FileManager.default.removeItem(at: file.url)
    files.removeAll { $0.id == file.id }
  }

  func deleteAll() {
    for file in files { try? FileManager.default.removeItem(at: file.url) }
    files = []
  }
}

struct DownloadsList: View {
  let model: DownloadsModel

  @Environment(AppModel.self) private var app
  @State private var previewing: URL?

  var body: some View {
    Group {
      if model.hasLoaded, model.files.isEmpty {
        ContentUnavailableView("No Downloads", systemImage: "arrow.down.circle", description: Text("Files you download show up here."))
      } else {
        LibraryList {
          ForEach(model.files) { file in
            Button {
              previewing = file.url
            } label: {
              DownloadRow(file: file)
            }
            .buttonStyle(.plain)
            .libraryRowChrome()
            .swipeActions {
              Button("Delete", role: .destructive) {
                withAnimation(Motion.snappy) { model.delete(file) }
              }
              ShareLink(item: file.url) { Text("Share") }
                .tint(Palette.formAccent)
            }
            .contextMenu {
              ShareLink(item: file.url)
              Button("Delete", systemImage: "trash", role: .destructive) { model.delete(file) }
            }
          }
        }
      }
    }
    .quickLookPreview($previewing, in: model.files.map(\.url))
    .task { model.reload(from: app.web.downloads.directory) }
    .refreshable { model.reload(from: app.web.downloads.directory) }
  }
}

private struct DownloadRow: View {
  var file: DownloadedFile

  var body: some View {
    HStack(alignment: .top, spacing: Spacing.small) {
      Image(systemName: file.symbol)
        .font(.system(size: SiteRow.libraryFavicon * 0.8))
        .foregroundStyle(.secondary)
        .frame(width: SiteRow.libraryFavicon, height: SiteRow.libraryFavicon)
        .padding(.top, 2)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(verbatim: file.name)
          .lineLimit(1)
          .truncationMode(.middle)
          .foregroundStyle(.primary)
        Text(verbatim: "\(file.size.formatted(.byteCount(style: .file))) · \(file.modified.formatted(date: .abbreviated, time: .shortened))")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, Spacing.small)
    .contentShape(.rect)
  }
}
