import ExpoModulesCore

public class AutofillModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaAutofill")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      AutofillModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)

    AsyncFunction("saveCard") { (profile: String, card: [String: Any], number: String?, promise: Promise) in
      ArdiaServices.saveCard(card, number: number, profile: profile) { CallReply(promise: promise).service($0, $1) }
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "autofill", handlers: [
    "settings": { args, reply in
      reply.ok([
        "addresses": ArdiaServices.boolPreference("autofill.profile_enabled", profile: args.profile),
        "cards": ArdiaServices.boolPreference("autofill.credit_card_enabled", profile: args.profile),
      ])
    },
    "setSettings": { args, reply in
      if let addresses = args.bool("addresses") { ArdiaServices.setBoolPreference("autofill.profile_enabled", value: addresses, profile: args.profile) }
      if let cards = args.bool("cards") { ArdiaServices.setBoolPreference("autofill.credit_card_enabled", value: cards, profile: args.profile) }
      reply.ok()
    },
    "addresses": { args, reply in ArdiaServices.addresses(profile: args.profile) { reply.service($0, $1) } },
    "saveAddress": { args, reply in ArdiaServices.saveAddress(args.dict("address") ?? [:], profile: args.profile) { reply.service($0, $1) } },
    "cards": { args, reply in ArdiaServices.cards(profile: args.profile) { reply.service($0, $1) } },
    "remove": { args, reply in ArdiaServices.deleteAutofillEntry(args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "cardNumber": { args, reply in ArdiaServices.revealCardNumber(args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "showSuggestions": { args, reply in
      reply.ok(ArdiaHost.showAutofillSuggestions(tabId: args.text("tabId"), passwords: args.bool("passwords") ?? false))
    },
  ])
}
