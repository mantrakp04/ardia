import Foundation

extension VaultsModule {
  static func addTotp(provider: String, id: String, token: String) async -> [String: Any] {
    guard let offer = VaultTotpSetup.offer(token) else { return VaultAddTotpResult.failure(.expired).jsonObject() }
    let result = await VaultBroker.shared.addTotp(provider: provider, id: id, uri: offer.uri)
    if result.item != nil { VaultTotpSetup.forget(token) }
    return result.jsonObject()
  }

  static let totpSetupCalls = CallTable(domain: "vaults", handlers: [
    "addTotp": { args, reply in
      let provider = try VaultsModule.provider(args)
      let id = try args.text("id")
      let token = try args.text("token")
      VaultsModule.answer(reply) { await VaultsModule.addTotp(provider: provider, id: id, token: token) }
    },
  ])
}
