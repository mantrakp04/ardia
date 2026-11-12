import Testing
@testable import ArdiaBrowser

@MainActor
@Suite struct PageRequestTests {
  private func signIn(realm: String?, failedBefore: Bool = false, isSecure: Bool) -> PageRequest {
    PageRequest(kind: .httpAuthentication(realm: realm, isProxy: false, failedBefore: failedBefore, isSecure: isSecure), host: "intranet.example") { _ in }
  }

  @Test func plainHTTPSignInNeverPromisesASecureSend() {
    let insecure = signIn(realm: "Staff", isSecure: false)
    #expect(insecure.message == "Your password will be sent unencrypted.")
    #expect(insecure.message?.contains("securely") == false)
    #expect(signIn(realm: nil, isSecure: false).message == "Your password will be sent unencrypted.")
  }

  @Test func secureSignInNamesTheRealm() {
    #expect(signIn(realm: "Staff", isSecure: true).message == "Your login information will be sent securely to “Staff”.")
    #expect(signIn(realm: nil, isSecure: true).message == nil)
  }

  @Test func aFailedAttemptSaysSoEitherWay() {
    for isSecure in [true, false] {
      #expect(signIn(realm: "Staff", failedBefore: true, isSecure: isSecure).message == "The user name or password you entered isn’t correct. Try again.")
    }
  }
}
