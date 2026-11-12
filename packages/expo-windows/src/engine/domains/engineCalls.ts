import { isFields, ok, originalProfile, passed, served, type Handlers } from "./calling";

const NO_ACTIVE_TAB = -1;

const text = (value: unknown) => (typeof value === "string" ? value : "");

export const engineCalls: Handlers = {
  info: async (_args, engine) => {
    const host = await engine.host("host.info");
    return ok({
      pid: 0,
      dataDirectory: text(host.userDataDir),
      engine: "ardiacore",
      chromiumVersion: text(host.chromium),
      liveBrowsers: 0,
      popupWindows: 0,
      chromeWindows: 0,
    });
  },
  components: async (_args, engine) => {
    const { components } = await served(engine, "ac_components_list", "");
    return ok(Array.isArray(components) ? components : []);
  },
  tasks: async (_args, engine) => {
    const { tasks } = await served(engine, "ac_tasks_list", "");
    return ok((Array.isArray(tasks) ? tasks : []).filter(isFields).map((task) => ({ ...task, tabIds: [] })));
  },
  validateKeepActiveSite: async (args, engine) => passed(engine, "ac_memory_saver", args.profile, JSON.stringify({ validate: args.text("site") })),
  setCliControl: async (args, engine) => passed(engine, "ac_cli_control", args.profile, JSON.stringify({ on: args.bool("on") })),
  setCliActiveTab: async (args, engine) => {
    if (args.optionalText("tabId") !== undefined) return engine.missing("engine", "setCliActiveTab", args.profile, args.json);
    return passed(engine, "ac_cli_control", args.profile, JSON.stringify({ active: NO_ACTIVE_TAB }));
  },
};

export const searchCalls: Handlers = {
  engines: async (args, engine) => {
    const { engines } = await served(engine, "ac_search_engines_list", originalProfile(args.profile));
    return ok({ list: { engines: engines ?? [] } });
  },
};
