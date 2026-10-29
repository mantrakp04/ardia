import { isFields, isStringList } from "./decode";
import type { SavedObject } from "./savedDocument";

type SavedSettings = SavedObject & { chosen?: string[]; inferred?: string[] };

export function sessionWithSettingsMeta(doc: SavedObject): SavedObject {
  if (!isFields(doc.settings) || (isFields(doc.settingsMeta) && !("chosen" in doc.settings) && !("inferred" in doc.settings))) return doc;
  const raw = withNewTabButtonPosition(withoutBatterySaver(doc.settings as SavedSettings))!;
  const legacy = !raw.chosen ? Object.keys(raw) : null;
  const { chosen, inferred, ...settings } = raw;
  return { ...doc, settings, settingsMeta: { chosen: legacy ?? (isStringList(chosen) ? chosen : []), inferred: legacy ?? (isStringList(inferred) ? inferred : []) } };
}

function withNewTabButtonPosition(saved: SavedSettings | undefined): SavedSettings | undefined {
  if (!saved || saved.newTabButtonPosition !== undefined || saved.newTabPosition !== "top") return saved;
  const alongside = (keys: string[]) => (keys.includes("newTabPosition") ? [...new Set([...keys, "newTabButtonPosition"])] : keys);
  return {
    ...saved,
    newTabButtonPosition: "top",
    ...(saved.chosen ? { chosen: alongside(saved.chosen) } : {}),
    ...(saved.inferred ? { inferred: alongside(saved.inferred) } : {}),
  };
}

function withoutBatterySaver(saved: (SavedSettings) | undefined): SavedSettings | undefined {
  if (!saved || !("batterySaver" in saved)) return saved;
  const { batterySaver, ...rest } = saved;
  const explicit = batterySaver === false || (batterySaver === true && !!rest.chosen?.includes("batterySaver") && !rest.inferred?.includes("batterySaver"));
  const without = (keys: string[]) => keys.filter((k) => k !== "batterySaver");
  return {
    ...rest,
    ...(rest.chosen ? { chosen: explicit ? [...new Set([...without(rest.chosen), "batterySaverWhen"])] : without(rest.chosen) } : {}),
    ...(rest.inferred ? { inferred: without(rest.inferred) } : {}),
    ...(explicit && rest.batterySaverWhen === undefined ? { batterySaverWhen: batterySaver ? "unplugged" : "never" } : {}),
  };
}
