import Foundation

extension VaultsModule {
  static let longestUsername = 1024

  static func saveGenerated(id: String, provider: String, username: String?, profile: String) async -> [String: Any] {
    guard let entry = await VaultGenerated.entry(id) else { return ["saved": false, "error": VaultFillError.notFound.rawValue] }
    let typed = String((username ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(longestUsername))
    let chosen = typed.isEmpty ? entry.username : typed
    guard !chosen.isEmpty else { return ["saved": false, "error": "needsUsername"] }
    let host = VaultOriginMatch.host(of: entry.origin) ?? entry.origin
    let title = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    let base = await ArdiaVaultStore.baseProfile(profile)
    let result = await VaultBroker.shared.save(provider: provider, origin: entry.origin, username: chosen, password: entry.password, title: title,
                                               profile: base)
    switch result {
    case .success(let item):
      VaultGenerated.saved(password: entry.password, origin: entry.origin)
      return ["saved": true, "item": item.jsonObject()]
    case .failure(let error):
      return ["saved": false, "error": error.rawValue]
    }
  }

  static let generatedCalls = CallTable(domain: "vaults", handlers: [
    "listGenerated": { _, reply in VaultsModule.answer(reply) { await VaultGenerated.list() } },
    "copyGenerated": { args, reply in
      let id = try args.text("id")
      VaultsModule.answer(reply) {
        guard let entry = await VaultGenerated.entry(id) else { return VaultCopyResult.refused(.notFound).jsonObject() }
        guard await VaultBroker.shared.ownerAllows("copy your password") else { return VaultCopyResult.declined.jsonObject() }
        return (await VaultClipboard.copy(entry.password) ? VaultCopyResult.copied : .clipboardFailed).jsonObject()
      }
    },
    "saveGenerated": { args, reply in
      let id = try args.text("id")
      let provider = try VaultsModule.provider(args)
      let username = try args.optionalText("username")
      let profile = args.profile
      VaultsModule.answer(reply) { await VaultsModule.saveGenerated(id: id, provider: provider, username: username, profile: profile) }
    },
    "deleteGenerated": { args, reply in
      let id = try args.text("id")
      VaultsModule.answer(reply) { ["deleted": await VaultGenerated.delete(id: id)] }
    },
    "setGeneratedRetention": { args, reply in
      let days = try args.double("days")
      VaultGenerated.setKeepDays(days.isFinite ? Int(max(min(days, Double(VaultGenerated.longestKeep)), -1)) : VaultGenerated.defaultKeepDays)
      reply.ok([String: Any]())
    },
  ])
}
