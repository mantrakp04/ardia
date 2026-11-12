import { isPrivateProfile, ok, served, type Engine, type Handlers } from "./calling";

const FOLDER_PREFIX = "Ardia ";
const UNSAFE = /[^A-Za-z0-9_-]/g;
const EVERY_KIND = ["history", "siteData", "cache", "downloads", "formData", "siteSettings"];
const GONE = new Set(["removed", "absent"]);

export const profileFolder = (profile: string) => FOLDER_PREFIX + profile.replace(UNSAFE, "_");

async function chromiumDataFolder(engine: Engine): Promise<string | null> {
  const { userDataDir } = await engine.host("host.info");
  return typeof userDataDir === "string" && userDataDir ? userDataDir : null;
}

export const profileCalls: Handlers = {
  clearBrowsingData: async (args, engine) => {
    const types = args.strings("types");
    const since = args.optionalDouble("since") ?? 0;
    if (!types.length) return ok();
    await served(engine, "ac_browsing_data_clear", args.profile, { types, since });
    return ok();
  },
  deleteData: async (args, engine) => {
    const { profile } = args;
    if (isPrivateProfile(profile)) return ok({ remaining: [] });
    if (!profile) return ok({ remaining: ["data"] });
    const root = await chromiumDataFolder(engine);
    if (!root) return ok({ remaining: ["data"] });
    const outcome = await engine.removeProfileFolder(root, profileFolder(profile));
    if (GONE.has(outcome)) return ok({ remaining: [] });
    if (outcome === "inUse") await served(engine, "ac_browsing_data_clear", profile, { types: EVERY_KIND, since: 0 });
    return ok({ remaining: [outcome === "inUse" ? "files in use until Ardia restarts" : `files (${outcome})`] });
  },
};
