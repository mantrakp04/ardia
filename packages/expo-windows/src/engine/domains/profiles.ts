import { isPrivateProfile, ok, served, type Engine, type Handlers } from "./calling";
import { deleteOriginalProfileData } from "./originalProfile";

const FOLDER_PREFIX = "Ardia ";
const SAFE = /^[A-Za-z0-9_-]$/;
const EVERY_KIND = ["history", "siteData", "cache", "downloads", "formData", "siteSettings"];
const GONE = new Set(["removed", "absent"]);
const OFF_THE_RECORD = "@";

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

function utf8Length(unit: number) {
  if (unit < 0x80) return 1;
  return unit < 0x800 ? 2 : 3;
}

export function profileFolder(profile: string): string | null {
  let folder = FOLDER_PREFIX;
  for (let i = 0; i < profile.length; i++) {
    const unit = profile.charCodeAt(i);
    if (isLowSurrogate(unit)) return null;
    if (isHighSurrogate(unit)) {
      if (!isLowSurrogate(profile.charCodeAt(i + 1))) return null;
      folder += "____";
      i++;
      continue;
    }
    const char = profile[i]!;
    folder += utf8Length(unit) === 1 && SAFE.test(char) ? char : "_".repeat(utf8Length(unit));
  }
  return folder;
}

const comparable = (path: string) => path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

async function sameDataFolder(engine: Engine): Promise<boolean> {
  const ours = engine.profileDataFolder();
  const { userDataDir } = await engine.host("host.info");
  return !!ours && typeof userDataDir === "string" && !!userDataDir && comparable(ours) === comparable(userDataDir);
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
    if (isPrivateProfile(profile) || profile.includes(OFF_THE_RECORD)) return ok({ remaining: [] });
    if (!profile) return ok({ remaining: await deleteOriginalProfileData(engine) });
    const folder = profileFolder(profile);
    if (!folder) return ok({ remaining: ["data (the profile's id isn't valid text)"] });
    if (!(await sameDataFolder(engine))) return ok({ remaining: ["data (Chromium keeps it in another folder)"] });
    const outcome = await engine.removeProfileFolder(folder);
    if (GONE.has(outcome)) return ok({ remaining: [] });
    if (outcome === "inUse") await served(engine, "ac_browsing_data_clear", profile, { types: EVERY_KIND, since: 0 });
    return ok({ remaining: [outcome === "inUse" ? "files in use until Ardia restarts" : `files (${outcome})`] });
  },
};
