import { isFields, isPrivateProfile, ok, quietly, served, type Args, type Handlers } from "./calling";

const PAGE_ENGINES = ["chromium", "webkit"] as const;
const ZOOM_STEP = 1.2;
const SAME_ZOOM = 1e-6;

const onChromium = (args: Args) => args.choice("engine", PAGE_ENGINES) === "chromium";

export const siteCalls: Handlers = {
  settings: async (args, engine) => {
    const chromium = onChromium(args);
    const origin = args.text("origin");
    if (!chromium) return engine.missing("sites", "settings", args.profile, args.json);
    const { settings } = await served(engine, "ac_site_settings_get", args.profile, { origin });
    return ok(isFields(settings) ? settings : {});
  },
  setSetting: async (args, engine) => {
    const chromium = onChromium(args);
    const setting = { origin: args.text("origin"), type: args.text("type"), value: args.text("value") };
    if (!chromium) return engine.missing("sites", "setSetting", args.profile, args.json);
    quietly(served(engine, "ac_site_settings_set", args.profile, setting));
    return ok();
  },
  origins: async (args, engine) => {
    const { origins } = await served(engine, "ac_site_settings_origins", args.profile);
    return ok(Array.isArray(origins) ? origins : []);
  },
  reset: async (args, engine) => {
    const origin = args.text("origin");
    quietly(served(engine, "ac_site_settings_reset", args.profile, { origin }));
    return ok();
  },
  clearData: async (args, engine) => {
    const chromium = onChromium(args);
    const origin = args.text("origin");
    if (!chromium) return engine.missing("sites", "clearData", args.profile, args.json);
    return ok(await served(engine, "ac_site_data_clear", args.profile, { origin }));
  },
  zoomLevels: async (args, engine) => {
    if (isPrivateProfile(args.profile)) return ok({});
    const { levels } = await served(engine, "ac_zoom_list", args.profile);
    const zooms = Object.entries(isFields(levels) ? levels : {}).map(([host, level]) => [host, Math.round(ZOOM_STEP ** Number(level) * 100) / 100]);
    return ok(Object.fromEntries(zooms));
  },
  setZoom: async (args, engine) => {
    const zoom = args.double("zoom");
    const host = args.text("host").toLowerCase();
    if (!host || zoom <= 0) return ok();
    const level = Math.abs(zoom - 1) < SAME_ZOOM ? 0 : Math.log(zoom) / Math.log(ZOOM_STEP);
    quietly(served(engine, "ac_zoom_set", args.profile, { host, level }));
    return ok();
  },
};
