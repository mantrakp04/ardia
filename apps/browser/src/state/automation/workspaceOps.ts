import { fixupUrl, isJavaScriptUrl, TAB_GROUP_COLORS } from "@ardia/core";
import type { GroupColor } from "../browser/types";
import { NO_GROUP_ICON } from "../groups/groupIcons";
import { symbolIcon } from "../../lib/customIcon";
import { EMOJI_GROUPS } from "../../lib/emojiData";
import { urlParts } from "../../lib/urlParts";
import { internalPageOf } from "../pages/urls";

export const MAX_OPS = 500;
export const MAX_URLS = 100;
const MAX_ID = 128;
const MAX_TEXT = 200;
const MAX_URL = 8192;

type Kind = "ref" | "refs" | "refOrNull" | "group" | "groupOrNull" | "id" | "urls" | "bool" | "text" | "textOrNull" | "icon" | "color" | "pinAs";

const TABS: Record<string, Kind> = { tabs: "refs" };

const SPECS = {
  open: { required: ["urls"], fields: { urls: "urls", window: "id", profile: "id", group: "group", before: "ref", after: "ref", pin: "pinAs", activate: "bool" } },
  "tab.move": { required: ["tabs"], fields: { ...TABS, group: "groupOrNull", before: "ref", after: "ref", window: "id", profile: "id" } },
  "tab.pin": { required: ["tabs"], fields: { ...TABS, as: "pinAs" } },
  "tab.unpin": { required: ["tabs"], fields: TABS },
  "tab.activate": { required: ["tab"], fields: { tab: "ref" } },
  "tab.mute": { required: ["tabs"], fields: TABS },
  "tab.unmute": { required: ["tabs"], fields: TABS },
  "tab.sleep": { required: ["tabs"], fields: TABS },
  "tab.wake": { required: ["tabs"], fields: TABS },
  "tab.close": { required: ["tabs"], fields: TABS },
  "tab.rename": { required: ["tab", "title"], fields: { tab: "ref", title: "textOrNull" } },
  "tab.icon": { required: ["tab", "icon"], fields: { tab: "ref", icon: "icon" } },
  "group.create": {
    required: [],
    fields: { tabs: "refs", urls: "urls", window: "id", profile: "id", parent: "group", pinned: "bool", name: "text", icon: "icon", color: "color", collapsed: "bool", before: "ref", after: "ref" },
  },
  "group.update": { required: ["group"], fields: { group: "group", name: "text", icon: "icon", color: "color", collapsed: "bool" } },
  "group.move": { required: ["group"], fields: { group: "group", parent: "groupOrNull", pinned: "bool", before: "ref", after: "ref", window: "id", profile: "id" } },
  "group.ungroup": { required: ["group"], fields: { group: "group" } },
  "group.close": { required: ["group"], fields: { group: "group" } },
  "group.delete": { required: ["group"], fields: { group: "group" } },
} satisfies Record<string, { required: string[]; fields: Record<string, Kind> }>;

export type OpName = keyof typeof SPECS;
export const OP_NAMES = Object.keys(SPECS) as OpName[];

export type Op = { op: OpName; [field: string]: unknown };

export type IconValue = string | null;

const COLORS: ReadonlySet<string> = new Set(TAB_GROUP_COLORS);

export function groupColor(value: string): GroupColor | null {
  return value === "neutral" ? null : (value as GroupColor);
}

let emojis: Set<string> | null = null;

function knownEmoji(text: string): boolean {
  emojis ??= new Set(EMOJI_GROUPS.flatMap((g) => g.list.split("\n").map((line) => line.split("\t")[0]!.replace(/️/g, ""))));
  return emojis.has(text.replace(/️/g, ""));
}

export function iconValue(value: unknown): IconValue | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (value === "none") return NO_GROUP_ICON;
  const symbol = /^symbol:([a-z0-9]+(?:\.[a-z0-9]+)*)$/.exec(value);
  if (symbol && symbol[1]!.length <= 64) return symbolIcon(symbol[1]!);
  return value.length <= 16 && knownEmoji(value) ? value : undefined;
}

export function openableUrl(value: string): string | { error: string } {
  if (!value.trim()) return { error: "An empty URL." };
  if (value.length > MAX_URL) return { error: "A URL longer than 8192 characters." };
  const url = fixupUrl(value);
  if (!url || isJavaScriptUrl(url)) return { error: `${JSON.stringify(value.slice(0, 200))} isn't a URL Ardia opens.` };
  if (url === "about:blank" || internalPageOf(url)) return url;
  if (url === "ardia://newtab" || url === "ardia://newtab/") return "";
  const parts = urlParts(url);
  if (parts && (parts.scheme === "http" || parts.scheme === "https" || (parts.scheme === "file" && parts.authority))) return url;
  return { error: `${JSON.stringify(value.slice(0, 200))}: the ardia command opens http, https and file URLs, about:blank and ardia://history, bookmarks, downloads and newtab.` };
}

const isRef = (value: unknown, index: number) =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID && (!/^\$/.test(value) || (/^\$\d+$/.test(value) && Number(value.slice(1)) < index));

export type GroupName = { name: string };

const isName = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= MAX_TEXT && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

function groupField(value: unknown, index: number): string | GroupName | null {
  if (typeof value === "string") return /^\$\d+$/.test(value) ? (isRef(value, index) ? value : null) : isName(value) ? value : null;
  const fields = value as Record<string, unknown> | null;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields) || Object.keys(fields).join() !== "name" || !isName(fields.name)) return null;
  return { name: fields.name.trim() };
}

const GROUP_FIELD = "a group id, a group's name, {\"name\": \"…\"}, or $N for an earlier operation's group";

function check(kind: Kind, value: unknown, index: number): unknown | { bad: string } {
  switch (kind) {
    case "group":
      return groupField(value, index) ?? { bad: GROUP_FIELD };
    case "groupOrNull":
      return value === null ? null : (groupField(value, index) ?? { bad: `${GROUP_FIELD}, or null` });
    case "ref":
      return isRef(value, index) ? value : { bad: "an id (or $N for an earlier operation's result)" };
    case "refOrNull":
      return value === null || isRef(value, index) ? value : { bad: "an id or null" };
    case "refs":
      return Array.isArray(value) && value.length > 0 && value.length <= MAX_OPS && value.every((v) => isRef(v, index)) ? value : { bad: "a non-empty list of ids" };
    case "id":
      return typeof value === "string" && value.length > 0 && value.length <= MAX_ID ? value : { bad: "an id" };
    case "bool":
      return typeof value === "boolean" ? value : { bad: "true or false" };
    case "text":
      return typeof value === "string" && value.length <= MAX_TEXT && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : { bad: `text of at most ${MAX_TEXT} characters without control characters` };
    case "textOrNull":
      return value === null ? null : check("text", value, index);
    case "pinAs":
      return value === "tile" || value === "row" ? value : { bad: "\"tile\" or \"row\"" };
    case "color":
      return typeof value === "string" && (value === "neutral" || value === "none" || COLORS.has(value)) ? value : { bad: `one of neutral, none, ${TAB_GROUP_COLORS.join(", ")}` };
    case "icon": {
      const icon = iconValue(value);
      return icon === undefined ? { bad: "an emoji from Ardia's picker, symbol:<SF Symbol name>, \"none\", or null to reset" } : icon;
    }
    case "urls": {
      const list = typeof value === "string" ? [value] : value;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_URLS || !list.every((v) => typeof v === "string")) return { bad: `a URL or a list of 1 to ${MAX_URLS} URLs` };
      const urls: string[] = [];
      for (const raw of list as string[]) {
        const url = openableUrl(raw);
        if (typeof url !== "string") return { bad: url.error, refused: true };
        urls.push(url);
      }
      return urls;
    }
  }
}

export type ParseError = { index: number; code: "bad_request" | "refused"; message: string };

export function parseOps(value: unknown): Op[] | ParseError {
  const list = Array.isArray(value) ? value : null;
  if (!list || list.length === 0 || list.length > MAX_OPS) return { index: -1, code: "bad_request", message: `ops is a list of 1 to ${MAX_OPS} operations.` };
  const out: Op[] = [];
  for (const [index, raw] of list.entries()) {
    const fail = (message: string, code: ParseError["code"] = "bad_request"): ParseError => ({ index, code, message: `Operation ${index}: ${message}` });
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("an operation is a JSON object.");
    const fields = raw as Record<string, unknown>;
    const name = fields.op;
    if (typeof name !== "string" || !(name in SPECS)) return fail(`op is one of: ${OP_NAMES.join(", ")}.`);
    const spec = SPECS[name as OpName] as { required: string[]; fields: Record<string, Kind> };
    const op: Op = { op: name as OpName };
    for (const [key, given] of Object.entries(fields)) {
      if (key === "op") continue;
      const kind = spec.fields[key];
      if (!kind) return fail(`${name} takes no ${key} (it takes ${Object.keys(spec.fields).join(", ")}).`);
      const checked = check(kind, given, index);
      if (checked && typeof checked === "object" && "bad" in checked) {
        const bad = checked as { bad: string; refused?: boolean };
        return fail(kind === "urls" && bad.refused ? bad.bad : `${key} must be ${bad.bad}.`, bad.refused ? "refused" : "bad_request");
      }
      op[key] = checked;
    }
    const missing = spec.required.filter((key) => op[key] === undefined);
    if (missing.length) return fail(`${name} needs ${missing.join(" and ")}.`);
    if (op.before !== undefined && op.after !== undefined) return fail("give before or after, not both.");
    if (name === "group.update" && Object.keys(op).length < 3) return fail("group.update needs name, icon, color or collapsed.");
    if (name === "tab.move" && op.window === undefined && op.profile === undefined && op.group === undefined && op.before === undefined && op.after === undefined) {
      return fail("tab.move needs a destination: group, before, after, window or profile.");
    }
    out.push(op);
  }
  return out;
}
