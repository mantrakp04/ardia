import { readDocument, writeDocument } from "../../platform/documents";
import type { AutofillToggle } from "../../platform/autofill";
import { isFields } from "../../lib/decode";
import { parseSaved, versionedJson } from "../../lib/savedDocument";

const DOC = "autofill-toggles-asked.json";
const VERSION = 1;

type Asked = Record<string, Partial<Record<AutofillToggle, boolean>>>;

function readAsked(): Asked {
  let doc: ReturnType<typeof parseSaved> = null;
  try {
    doc = parseSaved(readDocument(DOC), VERSION);
  } catch {
    doc = null;
  }
  const asked: Asked = {};
  if (!doc || !isFields(doc.profiles)) return asked;
  for (const [profile, toggles] of Object.entries(doc.profiles)) {
    if (!isFields(toggles)) continue;
    const kept: Partial<Record<AutofillToggle, boolean>> = {};
    for (const toggle of ["passwords", "addresses", "cards"] as const) if (typeof toggles[toggle] === "boolean") kept[toggle] = toggles[toggle];
    if (Object.keys(kept).length) asked[profile] = kept;
  }
  return asked;
}

export const askedValue = (profile: string, toggle: AutofillToggle): boolean | null => readAsked()[profile]?.[toggle] ?? null;

export function rememberAsked(profile: string, toggle: AutofillToggle, asked: boolean, now: boolean) {
  const all = readAsked();
  const toggles = { ...all[profile] };
  if (now === asked) delete toggles[toggle];
  else toggles[toggle] = asked;
  if (Object.keys(toggles).length) all[profile] = toggles;
  else delete all[profile];
  try {
    writeDocument(DOC, versionedJson({ profiles: all }, VERSION));
  } catch (error) {
    console.warn("[settings] couldn't save the autofill toggles asked for", error);
  }
}
