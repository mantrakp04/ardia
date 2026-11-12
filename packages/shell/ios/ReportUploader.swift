import Foundation

final class ReportUploader: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate {
  typealias Progress = (_ id: String, _ sent: Int64, _ total: Int64) -> Void
  typealias Done = (_ result: [String: Any]) -> Void

  private struct Upload {
    let id: String
    let done: Done
    var body = Data()
  }

  private var uploads: [Int: Upload] = [:]
  private let lock = NSLock()
  private let onProgress: Progress
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 60
    configuration.timeoutIntervalForResource = 15 * 60
    configuration.waitsForConnectivity = false
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  init(onProgress: @escaping Progress) {
    self.onProgress = onProgress
  }

  func upload(id: String, url: URL, method: String, headers: [String: String], file: URL, done: @escaping Done) {
    var request = URLRequest(url: url)
    request.httpMethod = method
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    let task = session.uploadTask(with: request, fromFile: file)
    lock.lock()
    uploads[task.taskIdentifier] = Upload(id: id, done: done)
    lock.unlock()
    task.resume()
  }

  func cancelAll() {
    session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData _: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    lock.lock()
    let id = uploads[task.taskIdentifier]?.id
    lock.unlock()
    if let id { onProgress(id, totalBytesSent, totalBytesExpectedToSend) }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    uploads[dataTask.taskIdentifier]?.body.append(data)
    lock.unlock()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let upload = uploads.removeValue(forKey: task.taskIdentifier)
    lock.unlock()
    guard let upload else { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    let cancelled = (error as? URLError)?.code == .cancelled
    upload.done([
      "status": error == nil ? status : 0,
      "body": String(decoding: upload.body.prefix(4096), as: UTF8.self),
      "error": error.map { cancelled ? "cancelled" : $0.localizedDescription } as Any,
    ])
  }
}
