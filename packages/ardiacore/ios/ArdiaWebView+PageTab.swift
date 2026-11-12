import AppKit

extension ArdiaWebView: PageTab {
  func startPage() {}

  func closePage() { closeBrowser() }

  func downloadFavicon(_ url: String, completion: @escaping ([String: Any]?) -> Void) {
    downloadFavicon(url, name: nil, completion: completion)
  }

  func copyCapturePicture(_ completion: @escaping (CGImage?, NSRect) -> Void) {
    copyPictureForCapture { picture, frame in completion(picture, frame) }
  }

  func copyFullPage(_ completion: @escaping (Data?) -> Void) {
    copyFullPagePicture { png in completion(png) }
  }
}
