import { ok, type Engine, type Fields, type Handlers } from "./calling";

const PEEK_KEYS = ["alt", "shift", "off"] as const;
const SPLIT_KEYS = ["alt", "altShift"] as const;

const configure = async (engine: Engine, change: Fields) => {
  await engine.host("peek.config", change).catch(() => ({}));
  return ok();
};

export const webViewCalls: Handlers = {
  setPeekModifier: (args, engine) => configure(engine, { peek: args.choice("modifier", PEEK_KEYS) }),
  setSplitLinkModifier: (args, engine) => configure(engine, { split: args.choice("modifier", SPLIT_KEYS) }),
  setPeekOtherSiteTabs: (args, engine) => configure(engine, { otherSitePages: args.strings("tabIds") }),
};
