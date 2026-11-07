import { isFields, type Fields } from "../../lib/decode";
import { parseMatchPattern, type MatchSpec } from "../../lib/matchPattern";
import { sha256 } from "../../lib/sha256";
import { DECIDE_EVENTS, MIN_IDLE_SECONDS, TAB_IDLE_EVENTS, USER_IDLE_EVENTS, isAutomationEvent, isDecideEvent, type DecideEvent } from "./eventNames";

export const HOOKS_FILE = "hooks.json";
export const MAX_HOOKS = 200;
export const MAX_REWRITES = 50;

const KEYS = [
  "name", "on", "at", "days", "timezone", "every", "match", "run", "command", "arg", "timeout", "idle", "fullUrls",
  "rewrite", "cancel", "route", "drop", "from", "folder", "permission", "kinds", "omnibox",
] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const RULE_KEYS: Record<string, DecideEvent> = {
  rewrite: "tab.opening",
  cancel: "tab.opening",
  route: "link.opening",
  drop: "link.opening",
  folder: "download.deciding",
  permission: "permission.requested",
};
const FILTER_KEYS: Record<string, DecideEvent> = { from: "link.opening", kinds: "permission.requested" };
const OPEN_MODES = ["tab", "littleArdia", "window"] as const;

export type Rewrite = { pattern: string; spec: MatchSpec; to: string };
export type Route = { profile: string | null; open: (typeof OPEN_MODES)[number] | null };
export type DecideRules = {
  rewrite?: Rewrite[];
  cancel?: true;
  route?: Route;
  drop?: true;
  folder?: string;
  permission?: "allow" | "deny" | "ask";
};
export type OmniboxSpec = { title: string; keyword: string | null; global: boolean };

export type HookSpec = {
  name: string;
  revision: string;
  on: string[];
  patterns: string[];
  specs: MatchSpec[];
  decide: DecideEvent | null;
  rules: DecideRules | null;
  program: string[] | null;
  command: { id: string; arg: string | null } | null;
  omnibox: OmniboxSpec | null;
  from: string[];
  kinds: string[];
  fullUrls: boolean;
  scheduled: boolean;
};

export type HooksRead = { hooks: HookSpec[]; problems: string[] };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isFields(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const hookRevision = (raw: Fields) => hex(sha256(canonicalJson(raw))).slice(0, 32);

export function parseDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const found = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!found) return null;
  return Number(found[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[found[2] as "s" | "m" | "h" | "d"];
}

const listOrOne = (value: unknown): unknown => (typeof value === "string" ? [value] : value);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

function patternsOf(value: unknown, label: string): { patterns: string[]; specs: MatchSpec[] } | string {
  const list = listOrOne(value ?? []);
  if (!isStringList(list)) return `${label} must be a list of match patterns`;
  const specs: MatchSpec[] = [];
  for (const pattern of list) {
    const spec = parseMatchPattern(pattern);
    if ("error" in spec) return `bad match pattern ${pattern}: ${spec.error}`;
    specs.push(spec);
  }
  return { patterns: list, specs };
}

function rulesOf(item: Fields, event: DecideEvent): DecideRules | string {
  const rules: DecideRules = {};
  if ("rewrite" in item) {
    const list = item.rewrite;
    if (!Array.isArray(list) || !list.length || list.length > MAX_REWRITES) return `rewrite must be a list of 1 to ${MAX_REWRITES} {"match", "to"} rules`;
    const rewrites: Rewrite[] = [];
    for (const rule of list) {
      if (!isFields(rule) || typeof rule.match !== "string" || typeof rule.to !== "string" || Object.keys(rule).some((k) => k !== "match" && k !== "to")) {
        return 'each rewrite rule is {"match": pattern, "to": URL}';
      }
      const spec = parseMatchPattern(rule.match);
      if ("error" in spec) return `bad match pattern ${rule.match}: ${spec.error}`;
      if (!/^https?:\/\//i.test(rule.to.replace(/^\{(url|origin)\}/, "https://x"))) return `rewrite to ${rule.to} must be an http or https URL`;
      rewrites.push({ pattern: rule.match, spec, to: rule.to });
    }
    rules.rewrite = rewrites;
  }
  if ("cancel" in item) {
    if (item.cancel !== true) return "cancel must be true";
    rules.cancel = true;
  }
  if ("drop" in item) {
    if (item.drop !== true) return "drop must be true";
    rules.drop = true;
  }
  if ("route" in item) {
    const route = item.route;
    if (!isFields(route) || Object.keys(route).some((k) => k !== "profile" && k !== "open")) return 'route is {"profile"?: name, "open"?: "tab" | "littleArdia" | "window"}';
    if (route.profile !== undefined && (typeof route.profile !== "string" || !route.profile)) return "route.profile must be a profile name or id";
    if (route.open !== undefined && !OPEN_MODES.includes(route.open as never)) return `route.open must be ${OPEN_MODES.join(", ")}`;
    if (route.profile === undefined && route.open === undefined) return "route needs profile or open";
    rules.route = { profile: (route.profile as string | undefined) ?? null, open: (route.open as Route["open"] | undefined) ?? null };
  }
  if ("folder" in item) {
    if (typeof item.folder !== "string" || !item.folder.startsWith("~/")) return "folder must be a path under your home folder, starting with ~/";
    if (item.folder.split("/").some((part) => part === ".." || part === ".")) return "folder can't contain . or .. parts";
    rules.folder = item.folder;
  }
  if ("permission" in item) {
    if (item.permission !== "allow" && item.permission !== "deny" && item.permission !== "ask") return "permission must be allow, deny or ask";
    rules.permission = item.permission;
  }
  if (Object.keys(rules).length > 1 && !(event === "tab.opening" && rules.rewrite && !rules.cancel)) return "give one answer: one of the decide keys";
  return rules;
}

function omniboxOf(value: unknown): OmniboxSpec | string {
  if (!isFields(value) || Object.keys(value).some((k) => !["title", "keyword", "global"].includes(k))) return 'omnibox is {"title", "keyword"} or {"title", "global": true}';
  if (typeof value.title !== "string" || !value.title.trim()) return "omnibox needs a title";
  const keyword = value.keyword;
  if (keyword !== undefined && (typeof keyword !== "string" || !/^\S{1,32}$/.test(keyword))) return "omnibox.keyword must be one word";
  if (value.global !== undefined && value.global !== true) return "omnibox.global must be true";
  if ((keyword === undefined) === (value.global === undefined)) return "omnibox takes a keyword or global: true, not both";
  return { title: value.title.trim(), keyword: (keyword as string | undefined) ?? null, global: value.global === true };
}

function checkTrigger(item: Fields): string | null {
  const triggers = ["on", "at", "every", "omnibox"].filter((k) => k in item);
  if (triggers.length !== 1) return "give exactly one of on, at, every or omnibox";
  if ("at" in item && (typeof item.at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.at))) return 'at must be a time like "09:00"';
  if ("days" in item) {
    if (!("at" in item)) return "days only goes with at";
    if (!isStringList(item.days) || !item.days.length || item.days.some((d) => !DAYS.includes(d))) return `days must be a list of ${DAYS.join(", ")}`;
  }
  if ("timezone" in item && (!("at" in item) || typeof item.timezone !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(item.timezone))) return "timezone goes with at and is a name like Europe/Paris";
  if ("every" in item) {
    const every = parseDuration(item.every);
    if (every === null || every < 60) return 'every must be a duration like "15m" or "1h", at least 1m';
  }
  return null;
}

function parseHook(item: Fields): Omit<HookSpec, "name" | "revision"> | string {
  const unknown = Object.keys(item).find((k) => !(KEYS as readonly string[]).includes(k));
  if (unknown) return `unknown key ${unknown}`;
  const trigger = checkTrigger(item);
  if (trigger) return trigger;
  const on = listOrOne(item.on ?? []);
  if (!isStringList(on)) return "on must be a list of event names";
  const decide = on.find(isDecideEvent) ?? null;
  for (const name of on) {
    if (name !== "*" && !isAutomationEvent(name) && !isDecideEvent(name)) return `unknown event ${name}`;
  }
  if ("on" in item && !on.length) return "give at least one event";
  if (decide && on.length !== 1) return `${decide} goes alone in on`;
  const matched = patternsOf(item.match, "match");
  if (typeof matched === "string") return matched;
  const ruleKeys = Object.keys(item).filter((k) => k in RULE_KEYS);
  const actions = ["run", "command"].filter((k) => k in item).length + (ruleKeys.length ? 1 : 0);
  if (actions !== 1) return "give exactly one of run, command or a decide answer (rewrite, cancel, route, drop, folder, permission)";
  for (const key of [...ruleKeys, ...Object.keys(item).filter((k) => k in FILTER_KEYS)]) {
    const owner = RULE_KEYS[key] ?? FILTER_KEYS[key];
    if (decide !== owner) return `${key} only goes with on: ["${owner}"]`;
  }
  let program: string[] | null = null;
  if ("run" in item) {
    if (typeof item.run === "string") return `run must be a list, like ["${item.run}"], or ["/bin/sh", "-c", "…"] for a shell line`;
    if (!isStringList(item.run) || !item.run.length || item.run.some((p) => !p || p.includes("\0"))) return "run must be a non-empty list of strings: [program, args…]";
    program = item.run;
  }
  let command: HookSpec["command"] = null;
  if ("command" in item) {
    if (typeof item.command !== "string" || !item.command) return "command must be a command id";
    if (decide || "omnibox" in item) return "command can't answer a decide event or the omnibox";
    command = { id: item.command, arg: null };
  }
  if ("arg" in item) {
    if (!command) return "arg only goes with command";
    if (typeof item.arg !== "string") return "arg must be a string";
    command.arg = item.arg;
  }
  if ("timeout" in item) {
    if (decide || "omnibox" in item || !program) return "timeout only goes with run on events and schedules; decide and omnibox hooks have fixed deadlines";
    if (typeof item.timeout !== "number" || !(item.timeout > 0 && item.timeout <= 86400)) return "timeout must be a number of seconds, more than 0 and at most 86400";
  }
  const idleEvents = on.filter((n) => TAB_IDLE_EVENTS.has(n) || USER_IDLE_EVENTS.has(n));
  if ("idle" in item) {
    const idle = parseDuration(item.idle);
    if (!idleEvents.length) return "idle only goes with tab.idle, tab.resumed, user.idle or user.active";
    if (idle === null || idle < MIN_IDLE_SECONDS) return 'idle must be a duration like "30m", at least 1m';
  } else if (idleEvents.length) return `${idleEvents[0]} needs idle, like "idle": "30m"`;
  if ("fullUrls" in item && typeof item.fullUrls !== "boolean") return "fullUrls must be true or false";
  let rules: DecideRules | null = null;
  if (ruleKeys.length) {
    const parsed = rulesOf(item, decide!);
    if (typeof parsed === "string") return parsed;
    rules = parsed;
  }
  let omnibox: OmniboxSpec | null = null;
  if ("omnibox" in item) {
    const parsed = omniboxOf(item.omnibox);
    if (typeof parsed === "string") return parsed;
    if (!program) return "an omnibox hook needs run";
    omnibox = parsed;
  }
  const from = listOrOne(item.from ?? []);
  if (!isStringList(from)) return "from must be a list of app bundle ids or names";
  const kinds = listOrOne(item.kinds ?? []);
  if (!isStringList(kinds)) return "kinds must be a list of permission kinds";
  return {
    on,
    ...matched,
    decide,
    rules,
    program,
    command,
    omnibox,
    from,
    kinds,
    fullUrls: item.fullUrls === true,
    scheduled: "at" in item || "every" in item,
  };
}

export function parseHooksDocument(doc: unknown): HooksRead {
  if (!isFields(doc) || !Array.isArray(doc.hooks)) return { hooks: [], problems: [`${HOOKS_FILE} must be an object with a "hooks" list`] };
  if (doc.hooks.length > MAX_HOOKS) return { hooks: [], problems: [`${HOOKS_FILE} has more than ${MAX_HOOKS} hooks`] };
  const hooks: HookSpec[] = [];
  const problems: string[] = [];
  const names = new Set<string>();
  doc.hooks.forEach((item: unknown, index: number) => {
    if (!isFields(item)) return void problems.push(`hook ${index + 1} must be an object`);
    const name = item.name;
    if (typeof name !== "string" || !name.trim()) return void problems.push(`hook ${index + 1} needs a name`);
    if (names.has(name)) return void problems.push(`hook ${name}: the name is used twice`);
    names.add(name);
    const parsed = parseHook(item);
    if (typeof parsed === "string") return void problems.push(`hook ${name}: ${parsed}`);
    hooks.push({ name, revision: hookRevision(item), ...parsed });
  });
  return { hooks: problems.length ? [] : hooks, problems };
}

export function parseHooksText(text: string): HooksRead {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { hooks: [], problems: [`${HOOKS_FILE} doesn't parse: ${(error as Error).message}`] };
  }
  return parseHooksDocument(doc);
}

export const decideEvents = DECIDE_EVENTS;
