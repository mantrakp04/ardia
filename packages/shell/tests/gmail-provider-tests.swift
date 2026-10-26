private actor GmailCallbackCompletion {
  private var complete = false
  func finish() { complete = true }
  func isComplete() -> Bool { complete }
}


actor GmailRefreshFixture {
  static let shared = GmailRefreshFixture()
  var continuations: [CheckedContinuation<GmailCredential, Never>] = []
  var credentials: [GmailCredential] = []
  func next(_ credential: GmailCredential) async -> GmailCredential {
    await withCheckedContinuation { continuation in continuations.append(continuation); credentials.append(credential) }
  }
  func waitFor(_ count: Int) async {
    for _ in 0..<10000 {
      if continuations.count == count { return }
      await Task.yield()
    }
    preconditionFailure("Refresh did not start")
  }
  func resolve(_ index: Int) { continuations[index].resume(returning: credentials[index]) }
  func count() -> Int { continuations.count }
}

@main
struct GmailTests {
  static func main() async throws {
    precondition(gmailClientSecret(nil, bundled: "bundle-value") == "bundle-value")
    precondition(gmailClientSecret("stored-value", bundled: "bundle-value") == "stored-value")
    for invalid: Any in ["", "$(ARDIA_GOOGLE_OAUTH_CLIENT_SECRET)", "${ARDIA_GOOGLE_OAUTH_CLIENT_SECRET}", "bad value", String(repeating: "x", count: 4097), 42] {
      precondition(gmailClientSecret(nil, bundled: invalid) == nil)
    }
    let unconfigured = GmailProvider()
    do { _ = try await unconfigured.connect(); preconditionFailure("Unconfigured Gmail opened sign-in") } catch { precondition(String(describing: error).contains("not available")) }
    let provider = GmailProvider()
    let missingSecret = Data(#"{"error":"invalid_request","error_description":"client_secret is missing."}"#.utf8)
    precondition(gmailRequestError(400, data: missingSecret, stage: "the Gmail token exchange").message.contains("configuration"))
    let invalidSecret = Data(#"{"error":"invalid_client","error_description":"secret-token-must-not-appear"}"#.utf8)
    let invalidMessage = gmailRequestError(401, data: invalidSecret, stage: "the Gmail token exchange").message
    precondition(invalidMessage.contains("configuration") && !invalidMessage.contains("secret-token-must-not-appear"))
    let expiredCode = Data(#"{"error":"invalid_grant","error_description":"code-must-not-appear"}"#.utf8)
    let expiredMessage = gmailRequestError(400, data: expiredCode, stage: "the Gmail token exchange").message
    precondition(expiredMessage.contains("expired") && !expiredMessage.contains("code-must-not-appear"))
    let nestedError = Data(#"{"error":{"code":403,"errors":[{"reason":"accessNotConfigured"}]}}"#.utf8)
    precondition(gmailRequestError(403, data: nestedError, stage: "the Gmail mailbox request").message.contains("Enable the Gmail API"))
    let scope = "https://www.googleapis.com/auth/gmail.readonly"
    let valid: [String: Any] = ["access_token": "access", "refresh_token": "refresh", "expires_in": 3600.0, "token_type": "Bearer", "scope": scope]
    let credential = try await provider.credentialOf(valid, previous: nil)
    precondition(credential.refreshToken == "refresh")
    var refresh = valid
    refresh.removeValue(forKey: "refresh_token")
    refresh.removeValue(forKey: "scope")
    let refreshed = try await provider.credentialOf(refresh, previous: credential)
    precondition(refreshed.refreshToken == credential.refreshToken)
    var expired = credential
    expired.expiresAt = 0
    GmailSecrets.value.credential = expired
    let first = Task { try await provider.access(generation: 0) }
    await GmailRefreshFixture.shared.waitFor(1)
    await provider.cancelCollection()
    let second = Task { try await provider.access(generation: 0) }
    await GmailRefreshFixture.shared.waitFor(2)
    await GmailRefreshFixture.shared.resolve(0)
    _ = try? await first.value
    let third = Task { try await provider.access(generation: 0) }
    for _ in 0..<100 { await Task.yield() }
    let refreshCount = await GmailRefreshFixture.shared.count()
    precondition(refreshCount == 2, "Cancelled refresh cleared a newer refresh slot")
    await GmailRefreshFixture.shared.resolve(1)
    _ = try await second.value
    _ = try await third.value
    for invalid in [valid.merging(["scope": "openid"]) { _, new in new }, valid.merging(["token_type": "Basic"]) { _, new in new }, valid.merging(["expires_in": -1.0]) { _, new in new }] {
      do { _ = try await provider.credentialOf(invalid, previous: nil); preconditionFailure("Invalid token accepted") } catch {}
    }
    let callback = try GmailCallback(state: "expected-state")
    let port = try await callback.start()
    for query in ["state=wrong&code=not-accepted", "state=expected-state&state=expected-state&code=not-accepted"] {
      let (_, response) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(port)/auth/callback?\(query)")!)
      precondition((response as? HTTPURLResponse)?.statusCode == 400)
    }
    let (_, response) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(port)/auth/callback?state=expected-state&code=accepted")!)
    precondition((response as? HTTPURLResponse)?.statusCode == 200)
    let fields = try await callback.wait()
    precondition(fields["code"] == "accepted")
    let cancelled = try GmailCallback(state: "cancelled")
    _ = try await cancelled.start()
    cancelled.cancel()
    do { _ = try await cancelled.wait(); preconditionFailure("Cancelled callback succeeded") } catch {}
    let stopped = try GmailCallback(state: "stopped")
    _ = try await stopped.start()
    let completion = GmailCallbackCompletion()
    let waiting = Task {
      do { _ = try await stopped.wait(); preconditionFailure("Stopped Gmail callback succeeded") }
      catch { await completion.finish() }
    }
    stopped.listener.cancel()
    for _ in 0..<50 {
      if await completion.isComplete() { _ = await waiting.value; print("Gmail callback and token validation passed"); return }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    preconditionFailure("Gmail listener failure after ready left sign-in suspended")
  }
}
