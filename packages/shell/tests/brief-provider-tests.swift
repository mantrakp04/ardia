extension BriefChatGPT {
  func testCrypto() throws {
    let samples = try (0..<32).map { _ in try random() }
    precondition(Set(samples).count == samples.count)
    precondition(samples.allSatisfy { $0.count == 43 && !$0.contains("=") })
    let data = Data((0..<256).map(UInt8.init))
    let roundtrip = try decode(encode(data))
    precondition(roundtrip == data)
    precondition(der(0x30, integer(Data([0x80])) + integer(Data([3]))) == Data([0x30, 0x07, 0x02, 0x02, 0, 0x80, 0x02, 0x01, 0x03]))
    precondition(der(0x30, Data(repeating: 0, count: 256)).prefix(4) == Data([0x30, 0x82, 0x01, 0]))
    let privateKey = SecKeyCreateRandomKey([kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits as String: 2048] as CFDictionary, nil)!
    let publicKey = SecKeyCopyPublicKey(privateKey)!
    let exported = SecKeyCopyExternalRepresentation(publicKey, nil)! as Data
    let restored = SecKeyCreateWithData(exported as CFData, [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeyClass as String: kSecAttrKeyClassPublic] as CFDictionary, nil)!
    let message = Data("test".utf8)
    let signature = SecKeyCreateSignature(privateKey, .rsaSignatureMessagePKCS1v15SHA256, message as CFData, nil)!
    precondition(SecKeyVerifySignature(restored, .rsaSignatureMessagePKCS1v15SHA256, message as CFData, signature, nil))
  }
}

private actor BriefCompletionFlag {
  private var complete = false
  func finish() { complete = true }
  func isComplete() -> Bool { complete }
}

@main struct Tests {
  private static func fixtureStore() throws -> BriefCredentialStore {
    var store = try BriefSecrets.load()
    store.active = "registered-client"
    store.accounts["registered-client"] = BriefCredential(clientId: "registered-client", subject: "fixture-subject", email: "fixture@example.invalid", accessToken: "fixture-access", refreshToken: nil, idToken: "fixture-id-token", expiresAt: Date().timeIntervalSince1970 + 3600, scopes: ["chatgpt.tokens.use.direct", "resource.invoke"])
    try BriefSecrets.save(store)
    return store
  }

  private static func testReviewCase(_ name: String) async throws {
    let provider = BriefChatGPT()
    switch name {
    case "isolated-storage":
      let saved = try fixtureStore()
      let path = URL(fileURLWithPath: ArdiaIsolatedDataDirectory()!).appendingPathComponent("Brief Provider Credentials.json").path
      precondition(!FileManager.default.fileExists(atPath: path), "Isolated ChatGPT credentials were written as plaintext JSON")
      let account = BriefSecrets.query[kSecAttrAccount as String] as! String
      precondition(account.hasPrefix("Ardia Daily Briefs ChatGPT:"), "Isolated ChatGPT credentials share the production Keychain item")
      let loaded = try BriefSecrets.load()
      precondition(loaded.hostId == saved.hostId)
    case "isolated-migration":
      let store = BriefCredentialStore(hostId: "urn:uuid:fixture-host", active: "fixture-client", accounts: ["fixture-client": BriefCredential(clientId: "fixture-client", subject: "fixture-subject", email: "fixture@example.invalid", accessToken: "fake-access", refreshToken: "fake-refresh", idToken: "fake-id", expiresAt: 42, scopes: ["resource.invoke"])])
      let directory = URL(fileURLWithPath: ArdiaIsolatedDataDirectory()!)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let url = directory.appendingPathComponent("Brief Provider Credentials.json")
      try JSONEncoder().encode(store).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      let loaded = try BriefSecrets.load()
      precondition(loaded.hostId == store.hostId && loaded.active == store.active)
      precondition(loaded.accounts["fixture-client"]?.refreshToken == "fake-refresh")
      precondition(!FileManager.default.fileExists(atPath: url.path), "Legacy isolated credentials remained plaintext after migration")
      let restored = try BriefSecrets.load()
      precondition(restored.accounts["fixture-client"]?.idToken == "fake-id")
    case "disconnect-account":
      let saved = try fixtureStore()
      _ = try await provider.disconnect()
      let result = try await provider.begin()
      let query = Dictionary(uniqueKeysWithValues: URLComponents(string: result["authorizationUrl"]!)!.queryItems!.map { ($0.name, $0.value!) })
      precondition(query["client_id"] == "dynamic_agent_client", "Disconnect retained the previous active account registration")
      precondition(query["id_token_hint"] == nil)
      precondition(query["ext_agent_host_id"] == saved.hostId)
      await provider.cancel()
    case "reauthorization-hint":
      _ = try fixtureStore()
      let result = try await provider.begin()
      let query = Dictionary(uniqueKeysWithValues: URLComponents(string: result["authorizationUrl"]!)!.queryItems!.map { ($0.name, $0.value!) })
      precondition(query["client_id"] == "registered-client")
      precondition(query["id_token_hint"] == nil, "Reauthorization exposed an ID token in its URL")
      precondition(query["login_hint"] == "fixture@example.invalid")
      await provider.cancel()
    case "callback-prestart-cancel":
      let callback = try BriefCallback(state: "fixture-state")
      callback.cancel()
      let completed = BriefCompletionFlag()
      let starting = Task {
        do { _ = try await callback.start(); preconditionFailure("Precancelled callback started") }
        catch { await completed.finish() }
      }
      for _ in 0..<50 {
        if await completed.isComplete() { _ = await starting.value; print("PASS callback-prestart-cancel"); return }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      preconditionFailure("Precancelled callback left startup suspended")
    case "callback-terminal":
      let callback = try BriefCallback(state: "fixture-state")
      _ = try await callback.start()
      let completed = BriefCompletionFlag()
      let waiting = Task {
        do { _ = try await callback.wait(); preconditionFailure("Stopped callback succeeded") }
        catch { await completed.finish() }
      }
      callback.listener.cancel()
      for _ in 0..<50 {
        if await completed.isComplete() { _ = await waiting.value; print("PASS callback-terminal"); return }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      preconditionFailure("A listener terminal state after ready left the OAuth waiter suspended")
    default: preconditionFailure("Unknown review case")
    }
    print("PASS \(name)")
  }

  private static func assertDisconnected(_ provider: BriefChatGPT) async throws {
    let status = try await provider.status()
    precondition(status["connected"] as? Bool == false)
  }
  static func main() async throws {
    defer { SecItemDelete(BriefSecrets.query as CFDictionary) }
    if let reviewCase = ProcessInfo.processInfo.environment["ARDIA_BRIEF_REVIEW_CASE"], reviewCase != "baseline" {
      try await testReviewCase(reviewCase)
      return
    }
    let provider = BriefChatGPT()
    try await provider.testCrypto()
    try await assertDisconnected(provider)
    let result = try await provider.begin()
    let url = URLComponents(string: result["authorizationUrl"]!)!
    let query = Dictionary(uniqueKeysWithValues: url.queryItems!.map { ($0.name, $0.value!) })
    precondition(url.host == "auth.openai.com")
    precondition(query["client_id"] == "dynamic_agent_client")
    precondition(query["code_challenge_method"] == "S256")
    precondition(query["state"]!.count == 43 && query["nonce"]!.count == 43)
    let callback = URLComponents(string: query["redirect_uri"]!)!
    precondition(callback.host == "127.0.0.1" && callback.path == "/auth/callback")
    let invalid = URL(string: "\(query["redirect_uri"]!)?state=invalid&code=fake&client_id=bad")!
    for _ in 0..<12 {
      let (_, response) = try await URLSession.shared.data(from: invalid)
      precondition((response as! HTTPURLResponse).statusCode == 400)
    }
    let completion = Task { try await provider.complete() }
    await provider.cancel()
    do {
      _ = try await completion.value
      fatalError("Cancelled callback incorrectly succeeded")
    } catch {}
    try await assertDisconnected(provider)
    let second = try await provider.begin()
    let params = URLComponents(string: second["authorizationUrl"]!)!.queryItems!
    let fields = Dictionary(uniqueKeysWithValues: params.map { ($0.name, $0.value!) })
    let fake = URL(string: "\(fields["redirect_uri"]!)?state=\(fields["state"]!)&code=fake&client_id=dynamic_agent_client")!
    _ = try await URLSession.shared.data(from: fake)
    do {
      _ = try await provider.complete()
      fatalError("Invalid dynamic client incorrectly accepted")
    } catch {}
    try await assertDisconnected(provider)
    do {
      _ = try await provider.generate("bad JSON")
      fatalError("Invalid context incorrectly accepted")
    } catch {}
    var store = try BriefSecrets.load()
    store.active = "test"
    store.accounts["test"] = BriefCredential(clientId: "test", subject: "test", email: "test@example.invalid", accessToken: "fake-test-token", refreshToken: nil, idToken: nil, expiresAt: Date().timeIntervalSince1970 + 3600, scopes: ["chatgpt.tokens.use.direct", "resource.invoke"])
    try BriefSecrets.save(store)
    let generation = Task { try await provider.generate("{\"context\":\"private fixture\"}") }
    let requestsPath = ProcessInfo.processInfo.environment["ARDIA_BRIEF_TEST_REQUESTS"]!
    let deadline = Date().addingTimeInterval(10)
    while !FileManager.default.fileExists(atPath: requestsPath) {
      if Date() > deadline { fatalError("The model lookup did not start before the deadline") }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    let cancelledAt = Date()
    await provider.cancelGeneration()
    do {
      _ = try await generation.value
      fatalError("Generation continued after consent changed")
    } catch {}
    precondition(Date().timeIntervalSince(cancelledAt) < 0.5, "Cancellation waited for the uncancelled model catalog request")
    let requests = try String(contentsOfFile: requestsPath, encoding: .utf8)
    precondition(requests.contains("/v1/models"))
    precondition(!requests.contains("/v1/responses"))
    store.accounts.removeAll()
    store.active = nil
    try BriefSecrets.save(store)
    print("PASS consent cancellation during catalog lookup prevents private context submission")
    print("PASS secure random, PKCE, RSA compatibility, loopback bind/path/state, cancellation, invalid client rejection, no false connection, JSON validation")
  }
}
