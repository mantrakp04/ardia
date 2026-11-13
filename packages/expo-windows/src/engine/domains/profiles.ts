import { ok, served, type Engine, type Handlers } from "./calling";
import { deleteOriginalProfileData } from "./originalProfile";
import { releaseProfile } from "../privateWindows";

const FOLDER_PREFIX = "Ardia ";
const LONGEST_ID = 238;
const ARDIA_ID = new RegExp(`^[a-z0-9-]{1,${LONGEST_ID}}$`);
const EVERY_KIND = ["history", "siteData", "cache", "downloads", "formData", "siteSettings"];
const GONE = new Set(["removed", "absent"]);
const OFF_THE_RECORD = "@";
const END_OF_NAME = "\u0000";
const NOT_ARDIAS = "data (the profile's id isn't one Ardia makes)";

export const profileFolder = (profile: string): string | null => (ARDIA_ID.test(profile) ? FOLDER_PREFIX + profile : null);

const comparable = (path: string) => path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

async function sameDataFolder(engine: Engine): Promise<boolean> {
  const ours = engine.profileDataFolder();
  const { userDataDir } = await engine.host("host.info");
  return !!ours && typeof userDataDir === "string" && !!userDataDir && comparable(ours) === comparable(userDataDir);
}

export const profileCalls: Handlers = {
  release: async (args, engine) => {
    await releaseProfile(args.profile, (profile) => engine.host("profile.release", { profile }));
    return ok();
  },
  clearBrowsingData: async (args, engine) => {
    const types = args.strings("types");
    const since = args.optionalDouble("since") ?? 0;
    if (!types.length) return ok();
    await served(engine, "ac_browsing_data_clear", args.profile, { types, since });
    return ok();
  },
  deleteData: async (args, engine) => {
    const { profile } = args;
    if (profile.includes(END_OF_NAME)) return ok({ remaining: [NOT_ARDIAS] });
    if (profile.includes(OFF_THE_RECORD)) return ok({ remaining: [] });
    if (!profile) return ok({ remaining: await deleteOriginalProfileData(engine) });
    const folder = profileFolder(profile);
    if (!folder) return ok({ remaining: [NOT_ARDIAS] });
    if (!(await sameDataFolder(engine))) return ok({ remaining: ["data (Chromium keeps it in another folder)"] });
    const outcome = await engine.removeProfileFolder(folder);
    if (GONE.has(outcome)) return ok({ remaining: [] });
    if (outcome === "inUse") await served(engine, "ac_browsing_data_clear", profile, { types: EVERY_KIND, since: 0 });
    return ok({ remaining: [outcome === "inUse" ? "files in use until Ardia restarts" : `files (${outcome})`] });
  },
};
