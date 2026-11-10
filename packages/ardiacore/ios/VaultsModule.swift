import ExpoModulesCore

public class VaultsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    OnCreate {
      VaultAutoLock.shared.start()
      Task { await VaultBroker.shared.resumeAfterQuit() }
    }

    Self.calls.function

    AsyncFunction("signIn") { (provider: String, fieldsJSON: String, promise: Promise) in
      let fields = VaultSignInFields(json: fieldsJSON)
      Task {
        guard let result = await VaultBroker.shared.signIn(provider, fields: fields) else {
          return promise.reject("ERR_BAD_ARGS", VaultsModule.unknown(provider))
        }
        promise.resolve(VaultJSON.text(result.jsonObject()))
      }
    }

    View(VaultTouchIDView.self) {
      Events("onStatus")
      Prop("armed") { (view: VaultTouchIDView, value: Bool?) in view.armed = value ?? false }
    }

    AsyncFunction("unlock") { (provider: String, password: String?, promise: Promise) in
      Task {
        guard let result = await VaultBroker.shared.unlock(provider, password: password) else {
          return promise.reject("ERR_BAD_ARGS", VaultsModule.unknown(provider))
        }
        promise.resolve(VaultJSON.text(result.jsonObject()))
      }
    }
  }

  static func unknown(_ provider: String) -> String { "vaults: \(provider) isn't a password manager Ardia knows" }

  static func provider(_ args: CallArgs) throws -> String {
    let id = try args.text("provider")
    guard VaultRegistry.provider(id) != nil else { throw BadCallArgs(message: "\(id) isn't a password manager Ardia knows") }
    return id
  }

  static func optionalProvider(_ args: CallArgs) throws -> String? {
    guard try args.optionalText("provider") != nil else { return nil }
    return try provider(args)
  }

  static func answer(_ reply: CallReply, _ work: @escaping @Sendable () async -> Any?) {
    Task { reply.ok(await work()) }
  }

  static let calls = CallTable(domain: "vaults", handlers: generatedCalls.handlers.merging([
    "providers": { _, reply in VaultsModule.answer(reply) { await VaultBroker.shared.providerStates().map { $0.jsonObject() } } },
    "refresh": { args, reply in
      let id = try VaultsModule.provider(args)
      VaultsModule.answer(reply) { await VaultBroker.shared.refresh(id, explicit: true)?.jsonObject() }
    },
    "items": { args, reply in
      let id = try VaultsModule.optionalProvider(args)
      VaultsModule.answer(reply) { await VaultBroker.shared.items(id).map { $0.jsonObject() } }
    },
    "lock": { args, reply in
      let id = try VaultsModule.provider(args)
      VaultsModule.answer(reply) { await VaultBroker.shared.lock(id)?.jsonObject() }
    },
    "signOut": { args, reply in
      let id = try VaultsModule.provider(args)
      VaultsModule.answer(reply) { await VaultBroker.shared.signOut(id)?.jsonObject() }
    },
    "configure": { args, reply in
      let id = try VaultsModule.provider(args)
      let server = try args.optionalText("server")
      VaultsModule.answer(reply) { await VaultBroker.shared.configure(id, server: server)?.jsonObject() }
    },
    "cancelSignIn": { args, reply in
      let id = try VaultsModule.provider(args)
      VaultsModule.answer(reply) { await VaultBroker.shared.cancelSignIn(id)?.jsonObject() }
    },
    "copy": { args, reply in
      let id = try VaultsModule.provider(args)
      let item = try args.text("id")
      guard let field = VaultCopyField(rawValue: try args.text("field")) else { return reply.ok(VaultCopyResult.refused(.notFound).jsonObject()) }
      VaultsModule.answer(reply) { await VaultBroker.shared.copy(id, item: item, field: field).jsonObject() }
    },
    "totp": { args, reply in
      let id = try VaultsModule.provider(args)
      let item = try args.text("id")
      VaultsModule.answer(reply) { await VaultBroker.shared.totp(id, item: item)?.jsonObject() }
    },
    "biometrics": { _, reply in reply.ok(["available": VaultOwnerCheck.biometricsAvailable]) },
    "sync": { _, reply in VaultsModule.answer(reply) { await VaultBroker.shared.sync().jsonObject() } },
    "syncStatus": { _, reply in VaultsModule.answer(reply) { await VaultBroker.shared.syncStatus().jsonObject() } },
    "generate": { args, reply in
      let style = VaultPasswordStyle(named: try args.optionalText("style"))
      let maxLength = try args.optionalDouble("maxLength").flatMap { $0.isFinite ? Int(min(max($0, 0), 4096)) : nil }
      reply.ok(["length": VaultPasswordGenerator.generate(style: style, maxLength: maxLength).count])
    },
    "export": { args, reply in
      let id = try VaultsModule.provider(args)
      VaultsModule.answer(reply) { await VaultBroker.shared.export(id).jsonObject() }
    },
    "setOptions": { args, reply in
      let minutes = try args.double("idleLockMinutes")
      let touchID = try args.bool("touchID")
      let askBeforeFilling = try args.optionalBool("askBeforeFilling") ?? true
      let iCloudSync = try args.optionalBool("iCloudSync") ?? true
      let lockOnQuit = try args.optionalBool("lockOnQuit") ?? true
      let lockOnScreenLock = try args.optionalBool("lockOnScreenLock") ?? true
      let idle = minutes.isFinite ? Int(min(max(minutes, 0), 10_080)) : 30
      VaultsModule.answer(reply) {
        await VaultBroker.shared.setOptions(
          idleLockMinutes: idle, touchID: touchID, askBeforeFilling: askBeforeFilling, iCloudSync: iCloudSync,
          lockOnQuit: lockOnQuit, lockOnScreenLock: lockOnScreenLock)
        return [String: Any]()
      }
    },
  ]) { _, listed in listed })
}
