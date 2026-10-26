import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

final class BangListFetch: NSObject, URLSessionDataDelegate {
  static let maxBytes = 5_000_000
  private static let listURL = URL(string: "https://services.helium.imput.net/bangs.json")!
  private static var running: Set<BangListFetch> = []
  private static let lock = NSLock()

  private var body = Data()
  private var response: HTTPURLResponse?
  private var failure: String?
  private let done: (Result<[String: Any], Error>) -> Void

  private init(done: @escaping (Result<[String: Any], Error>) -> Void) {
    self.done = done
  }

  private static var url: URL {
    #if DEBUG
    if let override = LaunchConfig.shared.testValue("bangsUrl"), let url = URL(string: override) { return url }
    #endif
    return listURL
  }

  static func start(etag: String?, done: @escaping (Result<[String: Any], Error>) -> Void) {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.httpCookieAcceptPolicy = .never
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 30
    config.timeoutIntervalForResource = 60
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let etag, !etag.isEmpty, etag.count <= 200, !etag.contains(where: { $0.isNewline }) {
      request.setValue(etag, forHTTPHeaderField: "If-None-Match")
    }
    let fetch = BangListFetch(done: done)
    lock.lock()
    running.insert(fetch)
    lock.unlock()
    let session = URLSession(configuration: config, delegate: fetch, delegateQueue: nil)
    session.dataTask(with: request).resume()
    session.finishTasksAndInvalidate()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    self.response = response as? HTTPURLResponse
    if response.expectedContentLength > Int64(Self.maxBytes) {
      failure = "too large"
      return completionHandler(.cancel)
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard failure == nil else { return }
    if body.count + data.count > Self.maxBytes {
      failure = "too large"
      body = Data()
      dataTask.cancel()
      return
    }
    body.append(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer {
      Self.lock.lock()
      Self.running.remove(self)
      Self.lock.unlock()
    }
    if let failure { return done(.failure(NSError(domain: "ArdiaBangs", code: 1, userInfo: [NSLocalizedDescriptionKey: failure]))) }
    if let error { return done(.failure(error)) }
    guard let response else { return done(.failure(NSError(domain: "ArdiaBangs", code: 2, userInfo: [NSLocalizedDescriptionKey: "no response"]))) }
    let text = response.statusCode == 200 ? String(data: body, encoding: .utf8) : nil
    if response.statusCode == 200 && text == nil {
      return done(.failure(NSError(domain: "ArdiaBangs", code: 3, userInfo: [NSLocalizedDescriptionKey: "not UTF-8"])))
    }
    let orNull = { (value: String?) -> Any in value.map { $0 as Any } ?? NSNull() }
    done(.success([
      "status": response.statusCode,
      "etag": orNull(response.value(forHTTPHeaderField: "ETag")),
      "contentType": orNull(response.value(forHTTPHeaderField: "Content-Type")),
      "body": orNull(text),
      "bytes": body.count,
    ]))
  }
}
