import { ok, served, type Handlers } from "./calling";

export const profileCalls: Handlers = {
  clearBrowsingData: async (args, engine) => {
    const types = args.strings("types");
    const since = args.optionalDouble("since") ?? 0;
    if (!types.length) return ok();
    await served(engine, "ac_browsing_data_clear", args.profile, { types, since });
    return ok();
  },
};
