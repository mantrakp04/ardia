import { isFields, ok, originalProfile, served, type Engine, type Fields, type Handlers } from "./calling";

function dated(result: Fields, key: string): Fields {
  const list = result[key];
  if (!Array.isArray(list)) return result;
  return { [key]: list.filter(isFields).map((entry) => ({ ...entry, created: 0, modified: 0 })) };
}

function textFields(address: Fields): Fields {
  const fields: Fields = {};
  for (const [key, value] of Object.entries(address)) {
    if (typeof value === "string") fields[key] = value;
    else if (typeof value === "number") fields[key] = String(value);
    else if (typeof value === "boolean") fields[key] = value ? "1" : "0";
  }
  return fields;
}

export const autofillCalls: Handlers = {
  addresses: async (args, engine) => ok(dated(await served(engine, "ac_autofill_addresses", originalProfile(args.profile)), "addresses")),
  saveAddress: async (args, engine) => {
    const address = textFields(args.dict("address"));
    return ok(await served(engine, "ac_autofill_save_address", originalProfile(args.profile), { address }));
  },
  cards: async (args, engine) => ok(dated(await served(engine, "ac_autofill_cards", originalProfile(args.profile)), "cards")),
  remove: async (args, engine) => {
    const id = args.text("id");
    return ok(await served(engine, "ac_autofill_remove", originalProfile(args.profile), { id }));
  },
  cardNumber: async (args, engine) => {
    const id = args.text("id");
    const { number } = await served(engine, "ac_autofill_card_number", originalProfile(args.profile), { id });
    return ok(typeof number === "string" ? { number } : {});
  },
};

export async function saveCard(engine: Engine, profile: string, card: Fields | null, number: string | null): Promise<string> {
  const secret = typeof number === "string" ? { number } : {};
  return ok(await served(engine, "ac_autofill_save_card", originalProfile(profile), { card: card ?? {}, ...secret }));
}
