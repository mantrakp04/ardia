import SwiftUI
import UniformTypeIdentifiers

extension View {
  func folderPicker(isPresented: Binding<Bool>, onPick: @escaping (URL) -> Void) -> some View {
    fileImporter(isPresented: isPresented, allowedContentTypes: [.folder], allowsMultipleSelection: false) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      onPick(url)
    }
    .fileDialogMessage(Text("Open iCloud Drive and choose the Ardia Sync folder."))
    .fileDialogConfirmationLabel(Text("Use Folder"))
  }
}
