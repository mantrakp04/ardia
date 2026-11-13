import ArdiaDesign
import SwiftUI

struct PageMenuSheet: View {
  let tabID: UUID

  @State private var contentHeight = PageMenuLayout.minimumHeight

  var body: some View {
    ScrollView {
      PageMenuContent(tabID: tabID)
        .padding(PageMenuLayout.inset)
    }
    .scrollBounceBehavior(.basedOnSize)
    .onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentSize.height + geometry.contentInsets.top + geometry.contentInsets.bottom
    } action: { _, height in
      contentHeight = height.rounded(.up)
    }
    .presentationDetents([.height(max(contentHeight, PageMenuLayout.minimumHeight))])
    .presentationDragIndicator(.hidden)
  }
}
