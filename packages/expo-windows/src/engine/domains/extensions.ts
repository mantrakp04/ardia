import { callError, isFields, ok, originalProfile, served, type Args, type Engine, type Fields, type Handler, type Handlers } from "./calling";

const WEB_STORE = "https://chromewebstore.google.com/detail/";
const ALWAYS_PRESENT = ["siteAccess", "optionsUrl", "path", "homepageUrl"];
const OPTIONS = ["pinned", "incognito", "fileAccess", "userScripts", "siteAccess"];

function listed(info: Fields): Fields {
  const item: Fields = Object.fromEntries(Object.entries(info).filter(([, value]) => value !== null));
  item.incognitoSplit = false;
  for (const key of ALWAYS_PRESENT) item[key] ??= null;
  const fromStore = info.location === "FROM_STORE";
  item.fromWebStore = fromStore;
  item.webStoreUrl = fromStore ? `${WEB_STORE}${String(info.id)}` : null;
  return item;
}

function changed(engine: Engine, profile: string, id: unknown, event: string) {
  if (typeof id === "string" && id) engine.emit("extensions.changed", { profile: originalProfile(profile), id, event });
}

const installing =
  (name: string): Handler =>
  async (args, engine) => {
    const path = args.text("path");
    const result = await served(engine, name, originalProfile(args.profile), { path });
    changed(engine, args.profile, result.id, "installed");
    return ok(result);
  };

async function run(engine: Engine, name: string, args: Args, sent: Fields, event: string): Promise<string> {
  const result = await served(engine, name, originalProfile(args.profile), sent);
  changed(engine, args.profile, sent.id, event);
  return ok(result);
}

export const extensionCalls: Handlers = {
  list: async (args, engine) => {
    const { extensions } = await served(engine, "ac_extensions_list", originalProfile(args.profile));
    if (!Array.isArray(extensions)) throw callError("ERR_ENGINE", "Unexpected extension list");
    return ok({ extensions: extensions.filter(isFields).map(listed) });
  },
  install: installing("ac_extensions_install"),
  installCrx: installing("ac_extensions_install_crx"),
  setEnabled: async (args, engine) => {
    const sent = { id: args.text("id"), enabled: args.bool("enabled") };
    return run(engine, "ac_extensions_set_enabled", args, sent, sent.enabled ? "enabled" : "disabled");
  },
  uninstall: async (args, engine) => run(engine, "ac_extensions_uninstall", args, { id: args.text("id") }, "uninstalled"),
  reload: async (args, engine) => run(engine, "ac_extensions_reload", args, { id: args.text("id") }, "reloaded"),
  configure: async (args, engine) => {
    const sent: Fields = { id: args.text("id") };
    const options = args.dict("options");
    for (const key of OPTIONS) if (options[key] !== undefined) sent[key] = options[key];
    return run(engine, "ac_extensions_configure", args, sent, "configured");
  },
};
