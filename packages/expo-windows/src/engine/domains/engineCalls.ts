import { isFields, ok, originalProfile, passed, served, type Handlers } from "./calling";
import { suggestCalls } from "./suggest";

const NO_ACTIVE_TAB = -1;

export const engineCalls: Handlers = {
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
  ...suggestCalls(),
  engines: async (args, engine) => {
    const { engines } = await served(engine, "ac_search_engines_list", originalProfile(args.profile));
    return ok({ list: { engines: engines ?? [] } });
  },
};
