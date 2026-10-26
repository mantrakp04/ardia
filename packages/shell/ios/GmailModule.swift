import ExpoModulesCore
import Foundation
import AppKit
import Network
import Security
import CryptoKit
import LocalAuthentication

public class GmailModule: Module {
  private let provider = GmailProvider()

  public func definition() -> ModuleDefinition {
    Name("ArdiaGmail")
    AsyncFunction("gmailStatus") { () async throws -> [String: Any] in try await self.provider.status() }
    AsyncFunction("connectGmail") { () async throws -> [String: Any] in try await self.provider.connect() }
    AsyncFunction("cancelGmailSignIn") { () async in await self.provider.cancelSignIn() }
    AsyncFunction("disconnectGmail") { () async throws -> Bool in try await self.provider.disconnect() }
    AsyncFunction("gmailMessages") { () async throws -> [[String: String]] in try await self.provider.messages() }
    AsyncFunction("cancelGmailCollection") { () async in await self.provider.cancelCollection() }
    AsyncFunction("setGmailClientSecret") { (secret: String) async throws in try await self.provider.setClientSecret(secret) }
  }
}

private struct GmailError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

private func gmailError(_ message: String) -> GmailError { GmailError(message: message) }

private func gmailRequestError(_ status: Int, data: Data, stage: String) -> GmailError {
  let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  let rawCode = body["error"] as? String ?? ""
  let code = rawCode.count <= 64 && rawCode.allSatisfy({ "abcdefghijklmnopqrstuvwxyz0123456789_".contains($0) }) ? rawCode : ""
  let description = body["error_description"] as? String ?? ""
  if code == "invalid_request", description.contains("client_secret") {
    return gmailError("Gmail sign-in needs updated app configuration. Please update Ardia and try again.")
  }
  if code == "invalid_client" { return gmailError("Google did not accept this build’s Gmail configuration. Please update Ardia and try again.") }
  if code == "invalid_grant" { return gmailError("Google’s authorization code expired or was already used. Start Gmail sign-in again.") }
  if code == "redirect_uri_mismatch" { return gmailError("Google did not accept Ardia’s local callback. Check that this OAuth client is a Desktop app.") }
  let apiError = body["error"] as? [String: Any] ?? [:]
  let reasons = (apiError["errors"] as? [[String: Any]] ?? []).compactMap { $0["reason"] as? String }
  if reasons.contains("accessNotConfigured") || reasons.contains("serviceDisabled") { return gmailError("Enable the Gmail API in the Google Cloud project for this Desktop app, then try again.") }
  if status == 401 { return gmailError("Gmail needs to be reconnected in Settings › Daily Briefs.") }
  return gmailError("Google could not complete \(stage) (HTTP \(status)\(code.isEmpty ? "" : ", \(code)")).")
}

private struct GmailCredential: Codable {
  var accessToken: String
  var refreshToken: String
  var expiresAt: Double
  var email: String
  var scopes: [String]
}

private struct GmailStore: Codable {
  var credential: GmailCredential?
  var clientSecret: String?
}

private enum GmailSecrets {
  static var query: [String: Any] {
    let suffix = ArdiaIsolatedDataDirectory().map { ":" + SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined() } ?? ""
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Ardia Connected Accounts", kSecAttrAccount as String: "Ardia Daily Briefs Gmail" + suffix]
  }
  static func load() throws -> GmailStore {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    let context = LAContext()
    context.interactionNotAllowed = true
    q[kSecUseAuthenticationContext as String] = context
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return GmailStore() }
    guard status == errSecSuccess, let data = result as? Data else { throw gmailError("Couldn’t read Gmail credentials from Keychain.") }
    return try JSONDecoder().decode(GmailStore.self, from: data)
  }
  static func save(_ store: GmailStore) throws {
    guard store.credential != nil || store.clientSecret != nil else {
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw gmailError("Couldn’t remove Gmail credentials from Keychain.") }
      return
    }
    let data = try JSONEncoder().encode(store)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var q = query
      q[kSecValueData as String] = data
      q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw gmailError("Couldn’t save Gmail credentials to Keychain.") }
    } else if status != errSecSuccess { throw gmailError("Couldn’t update Gmail credentials in Keychain.") }
  }
}

private final class GmailRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

private typealias GmailCallback = OAuthLoopbackCallback

private func gmailClientSecret(_ stored: String?, bundled: Any? = Bundle.main.object(forInfoDictionaryKey: "ArdiaGoogleOAuthClientSecret")) -> String? {
  for candidate in [stored, bundled as? String] {
    guard let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty, value.count <= 4096, !value.contains(where: { $0.isWhitespace }), !value.contains("$("), !value.contains("${") else { continue }
    return value
  }
  return nil
}

private actor GmailProvider {
  private let clientId = "440343742504-72o24jd3qds5hbfhivj4rg1m7fksa3la.apps.googleusercontent.com"
  private let scope = "https://www.googleapis.com/auth/gmail.readonly"
  private var callback: GmailCallback?
  private var revision = 0
  private var collectionRevision = 0
  private var sessions: [UUID: (session: URLSession, collection: Bool)] = [:]
  private var refreshTask: (id: UUID, task: Task<GmailCredential, Error>)?

  func status() throws -> [String: Any] { statusOf(try GmailSecrets.load()) }

  func setClientSecret(_ secret: String) throws {
    invalidate()
    var store = try GmailSecrets.load()
    let value = secret.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.count <= 4096, !value.contains(where: { $0.isWhitespace }) else { throw gmailError("Enter the client secret from this Google Desktop app’s credentials.") }
    store.clientSecret = value.isEmpty ? nil : value
    try GmailSecrets.save(store)
  }

  func cancelSignIn() { if callback != nil { invalidate() } }

  func cancelCollection() {
    collectionRevision += 1
    for (id, entry) in sessions where entry.collection { entry.session.invalidateAndCancel(); sessions.removeValue(forKey: id) }
    refreshTask?.task.cancel()
    refreshTask = nil
  }

  func connect() async throws -> [String: Any] {
    invalidate()
    let store = try GmailSecrets.load()
    guard gmailClientSecret(store.clientSecret) != nil else { throw gmailError("Gmail sign-in is not available in this build yet.") }
    let generation = revision
    let state = try random()
    let verifier = try random()
    let listener = try GmailCallback(state: state, service: "Google")
    callback = listener
    defer { if revision == generation { callback = nil }; listener.cancel() }
    let port = try await listener.start()
    try check(generation)
    let redirect = "http://127.0.0.1:\(port)/auth/callback"
    var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    components.queryItems = ["client_id": clientId, "redirect_uri": redirect, "response_type": "code", "scope": scope, "code_challenge": encode(Data(SHA256.hash(data: Data(verifier.utf8)))), "code_challenge_method": "S256", "state": state, "access_type": "offline", "prompt": "consent"].map { URLQueryItem(name: $0.key, value: $0.value) }
    let authorizationURL = components.url!
    let opened = await MainActor.run { NSWorkspace.shared.open(authorizationURL) }
    try check(generation)
    guard opened else { throw gmailError("Couldn’t open the system browser for Google sign-in.") }
    let fields = try await listener.wait()
    try check(generation)
    guard fields["error"] == nil else { throw gmailError("Google sign-in was not approved.") }
    guard let code = fields["code"], !code.isEmpty, code.count <= 4096 else { throw gmailError("Google did not return a valid authorization code.") }
    var parameters = ["client_id": clientId, "code": code, "code_verifier": verifier, "grant_type": "authorization_code", "redirect_uri": redirect]
    if let secret = gmailClientSecret(store.clientSecret) { parameters["client_secret"] = secret }
    let tokens = try await post("https://oauth2.googleapis.com/token", parameters, generation: generation)
    try check(generation)
    var credential = try credentialOf(tokens, previous: nil)
    let profile = try await get("https://gmail.googleapis.com/gmail/v1/users/me/profile", token: credential.accessToken, generation: generation)
    try check(generation)
    guard let email = profile["emailAddress"] as? String, !email.isEmpty, email.count <= 320 else { throw gmailError("Google did not return a Gmail account.") }
    credential.email = email
    var updated = try GmailSecrets.load()
    updated.credential = credential
    try GmailSecrets.save(updated)
    return statusOf(updated)
  }

  func disconnect() async throws -> Bool {
    invalidate()
    let generation = revision
    var store = try GmailSecrets.load()
    let token = store.credential?.refreshToken
    store.credential = nil
    try GmailSecrets.save(store)
    guard let token else { return true }
    do {
      _ = try await post("https://oauth2.googleapis.com/revoke", ["token": token], generation: generation, emptyResponse: true)
      return true
    } catch { return false }
  }

  func messages() async throws -> [[String: String]] {
    let generation = revision
    let collection = collectionRevision
    let deadline = Date().addingTimeInterval(45)
    let credential = try await access(generation: generation)
    try check(generation, collection)
    let listing = try await get("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&labelIds=INBOX&q=newer_than%3A1d", token: credential.accessToken, generation: generation, deadline: deadline, collection: true)
    try check(generation, collection)
    let items = Array((listing["messages"] as? [[String: Any]] ?? []).prefix(15))
    var messages: [[String: String]] = []
    for item in items {
      try check(generation, collection)
      guard let id = item["id"] as? String, id.count <= 64, id.allSatisfy({ $0.isHexDigit }) else { continue }
      let json = try await get("https://gmail.googleapis.com/gmail/v1/users/me/messages/\(id)?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&fields=id,snippet,payload%2Fheaders", token: credential.accessToken, generation: generation, deadline: deadline, collection: true)
      try check(generation, collection)
      let headers = (json["payload"] as? [String: Any])?["headers"] as? [[String: String]] ?? []
      func header(_ name: String, limit: Int) -> String { String((headers.first { $0["name"]?.lowercased() == name.lowercased() }?["value"] ?? "").prefix(limit)) }
      messages.append(["id": id, "subject": header("Subject", limit: 300), "from": header("From", limit: 300), "date": header("Date", limit: 100), "snippet": String((json["snippet"] as? String ?? "").prefix(600))])
    }
    try check(generation, collection)
    return messages
  }

  private func access(generation: Int) async throws -> GmailCredential {
    guard let credential = try GmailSecrets.load().credential else { throw gmailError("Connect Gmail in Settings › Daily Briefs first.") }
    if credential.expiresAt > Date().timeIntervalSince1970 + 60 { return credential }
    if let task = refreshTask {
      let value = try await task.task.value
      try check(generation)
      return value
    }
    let id = UUID()
    let task = Task { try await self.refresh(credential, generation: generation) }
    refreshTask = (id, task)
    defer { if refreshTask?.id == id { refreshTask = nil } }
    let value = try await task.value
    try check(generation)
    return value
  }

  private func refresh(_ credential: GmailCredential, generation: Int) async throws -> GmailCredential {
    try check(generation)
    let store = try GmailSecrets.load()
    var fields = ["client_id": clientId, "refresh_token": credential.refreshToken, "grant_type": "refresh_token"]
    if let secret = gmailClientSecret(store.clientSecret) { fields["client_secret"] = secret }
    let json = try await post("https://oauth2.googleapis.com/token", fields, generation: generation, collection: true)
    try check(generation)
    let refreshed = try credentialOf(json, previous: credential)
    var updated = try GmailSecrets.load()
    updated.credential = refreshed
    try GmailSecrets.save(updated)
    return refreshed
  }

  private func credentialOf(_ fields: [String: Any], previous: GmailCredential?) throws -> GmailCredential {
    guard let access = fields["access_token"] as? String, !access.isEmpty, access.count <= 16384, let seconds = fields["expires_in"] as? Double, seconds > 0, seconds <= 86400, (fields["token_type"] as? String)?.lowercased() == "bearer" else { throw gmailError("Google returned incomplete credentials. Try connecting Gmail again.") }
    let scopes = (fields["scope"] as? String)?.split(separator: " ").map(String.init) ?? previous?.scopes ?? []
    guard scopes.contains(scope), let refresh = fields["refresh_token"] as? String ?? previous?.refreshToken, !refresh.isEmpty, refresh.count <= 16384 else { throw gmailError("Google did not grant offline read-only Gmail access. Reconnect and approve Gmail permission.") }
    return GmailCredential(accessToken: access, refreshToken: refresh, expiresAt: Date().timeIntervalSince1970 + seconds, email: previous?.email ?? "", scopes: scopes)
  }

  private func statusOf(_ store: GmailStore) -> [String: Any] {
    ["connected": store.credential?.scopes.contains(scope) == true, "email": store.credential?.email ?? "", "clientSecretConfigured": gmailClientSecret(store.clientSecret) != nil]
  }

  private func invalidate() {
    revision += 1
    callback?.cancel()
    callback = nil
    cancelCollection()
    for entry in sessions.values { entry.session.invalidateAndCancel() }
    sessions.removeAll()
  }

  private func check(_ generation: Int, _ collection: Int? = nil) throws {
    guard generation == revision, collection == nil || collection == collectionRevision, !Task.isCancelled else { throw gmailError("Gmail connection or permission changed. Please try again.") }
  }

  private func encode(_ bytes: Data) -> String { bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }

  private func random() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw gmailError("Couldn’t generate secure Google sign-in parameters.") }
    return encode(Data(bytes))
  }

  private func get(_ url: String, token: String, generation: Int, deadline: Date? = nil, collection: Bool = false) async throws -> [String: Any] {
    var request = URLRequest(url: URL(string: url)!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    return try await fetch(request, generation: generation, deadline: deadline, collection: collection)
  }

  private func post(_ url: String, _ fields: [String: String], generation: Int, emptyResponse: Bool = false, collection: Bool = false) async throws -> [String: Any] {
    var request = URLRequest(url: URL(string: url)!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    var allowed = CharacterSet.urlQueryAllowed
    allowed.remove(charactersIn: "+&=#?")
    request.httpBody = fields.map { "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&").data(using: .utf8)
    return try await fetch(request, generation: generation, emptyResponse: emptyResponse, collection: collection)
  }

  private func fetch(_ request: URLRequest, generation: Int, emptyResponse: Bool = false, deadline: Date? = nil, collection: Bool = false) async throws -> [String: Any] {
    try check(generation)
    let remaining = deadline?.timeIntervalSinceNow ?? 25
    guard remaining > 0 else { throw gmailError("Gmail took too long to respond. Please try again.") }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = min(20, remaining)
    configuration.timeoutIntervalForResource = min(25, remaining)
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    let session = URLSession(configuration: configuration, delegate: GmailRedirectDelegate(), delegateQueue: nil)
    let id = UUID()
    sessions[id] = (session, collection)
    defer { session.invalidateAndCancel(); sessions.removeValue(forKey: id) }
    let (bytes, response) = try await session.bytes(for: request)
    var data = Data()
    for try await byte in bytes {
      guard data.count < 512_000 else { throw gmailError("Google returned too much data.") }
      data.append(byte)
      if data.count % 4096 == 0 { try check(generation) }
    }
    try check(generation)
    guard data.count <= 512_000, let response = response as? HTTPURLResponse else { throw gmailError("Google returned an invalid response.") }
    guard (200..<300).contains(response.statusCode) else {
      let stage = request.url?.host == "oauth2.googleapis.com" ? (request.url?.path == "/revoke" ? "Gmail access revocation" : "the Gmail token exchange") : "the Gmail mailbox request"
      throw gmailRequestError(response.statusCode, data: data, stage: stage)
    }
    if emptyResponse { return [:] }
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw gmailError("Google returned an invalid response.") }
    return json
  }
}
