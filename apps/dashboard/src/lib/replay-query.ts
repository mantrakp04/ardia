export const FIELD_KINDS = {
  number: ["gte", "lte", "gt", "lt", "eq", "neq"],
  bool: ["is"],
  choice: ["is", "is_not"],
  text: ["contains", "not_contains", "starts_with"],
  domain: ["is", "is_not", "contains", "not_contains"],
  date: ["after", "before"],
} as const;

export type FieldKind = keyof typeof FIELD_KINDS;
export type ReplayOp = (typeof FIELD_KINDS)[FieldKind][number];

export const REPLAY_FIELDS = {
  length: { label: "Length", kind: "number", unit: "s" },
  pages: { label: "Pages", kind: "number", unit: "" },
  clicks: { label: "Clicks", kind: "number", unit: "" },
  size: { label: "Size", kind: "number", unit: "KB" },
  download: { label: "Clicked download", kind: "bool", unit: "" },
  customize: { label: "Clicked Customize it", kind: "bool", unit: "" },
  device: { label: "Device", kind: "choice", unit: "" },
  browser: { label: "Browser", kind: "choice", unit: "" },
  os: { label: "OS", kind: "choice", unit: "" },
  country: { label: "Country", kind: "choice", unit: "" },
  first_page: { label: "First page", kind: "text", unit: "" },
  any_page: { label: "Any page", kind: "text", unit: "" },
  referrer: { label: "Referrer", kind: "domain", unit: "" },
  started: { label: "Started", kind: "date", unit: "" },
} as const satisfies Record<string, { label: string; kind: FieldKind; unit: string }>;

export type ReplayField = keyof typeof REPLAY_FIELDS;
export const FIELD_NAMES = Object.keys(REPLAY_FIELDS) as ReplayField[];

export const OP_LABEL: Record<ReplayOp, string> = {
  gte: "≥",
  lte: "≤",
  gt: ">",
  lt: "<",
  eq: "=",
  neq: "≠",
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "path starts with",
  after: "after",
  before: "before",
};

export type ReplayCondition = { field: ReplayField; op: ReplayOp; value: string | number };
export type ConditionTuple = [string, string, string | number];
export type ReplayMatch = "all" | "any";

export const REPLAY_SORTS = ["newest", "longest", "clicks"] as const;
export type ReplaySort = (typeof REPLAY_SORTS)[number];

export const MAX_CONDITIONS = 12;
const MAX_TEXT = 200;
const MAX_NUMBER = 1e12;
const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

export const opsFor = (field: ReplayField): readonly ReplayOp[] => FIELD_KINDS[REPLAY_FIELDS[field].kind];

export function dateValueMs(value: string): number | null {
  const parts = DATE_VALUE.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const exact = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute;
  return exact ? date.getTime() : null;
}

export function parseCondition(field: unknown, op: unknown, value: unknown): ReplayCondition | null {
  if (typeof field !== "string" || !Object.hasOwn(REPLAY_FIELDS, field)) return null;
  const name = field as ReplayField;
  if (typeof op !== "string" || !(opsFor(name) as readonly string[]).includes(op)) return null;
  const kind = REPLAY_FIELDS[name].kind;
  if (kind === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > MAX_NUMBER) return null;
    return { field: name, op: op as ReplayOp, value: Math.round(n * 100) / 100 };
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().slice(0, MAX_TEXT);
  if (kind === "bool") return text === "yes" || text === "no" ? { field: name, op: op as ReplayOp, value: text } : null;
  if (kind === "date") return dateValueMs(text) === null ? null : { field: name, op: op as ReplayOp, value: text };
  if (!text) return null;
  return { field: name, op: op as ReplayOp, value: text };
}

export function parseConditions(input: unknown): ReplayCondition[] {
  if (!Array.isArray(input)) return [];
  const out: ReplayCondition[] = [];
  for (const item of input.slice(0, MAX_CONDITIONS)) {
    const parsed = Array.isArray(item)
      ? parseCondition(item[0], item[1], item[2])
      : item && typeof item === "object"
        ? parseCondition((item as ReplayCondition).field, (item as ReplayCondition).op, (item as ReplayCondition).value)
        : null;
    if (parsed && !out.some((c) => sameCondition(c, parsed))) out.push(parsed);
  }
  return out;
}

export const parseMatch = (value: unknown): ReplayMatch => (value === "any" ? "any" : "all");

export const sameCondition = (a: ReplayCondition, b: ReplayCondition) => a.field === b.field && a.op === b.op && a.value === b.value;

export const toTuples = (conditions: ReplayCondition[]): ConditionTuple[] => conditions.map((c) => [c.field, c.op, c.value]);

export function presetValue(conditions: ReplayCondition[], field: ReplayField, op: ReplayOp) {
  return conditions.find((c) => c.field === field && c.op === op)?.value;
}

export function withPreset(conditions: ReplayCondition[], field: ReplayField, op: ReplayOp, value: string | number | undefined): ReplayCondition[] {
  const index = conditions.findIndex((c) => c.field === field && c.op === op);
  const next = value === undefined || value === "" ? null : parseCondition(field, op, value);
  if (index === -1) return next ? [...conditions, next] : conditions;
  return next ? conditions.map((c, i) => (i === index ? next : c)) : conditions.filter((_, i) => i !== index);
}

export function legacyConditions(search: Record<string, unknown>): ReplayCondition[] {
  const out: (ReplayCondition | null)[] = [];
  const min = Math.floor(Number(search.min));
  if (min > 0) out.push(parseCondition("length", "gte", Math.min(min, 86_400)));
  if (search.clicks === true || search.clicks === "true" || search.clicks === "1") out.push(parseCondition("clicks", "gt", 0));
  if (typeof search.device === "string" && search.device) out.push(parseCondition("device", "is", search.device.slice(0, 40)));
  if (typeof search.url === "string" && search.url) out.push(parseCondition("first_page", "contains", search.url));
  if (search.download === "yes" || search.download === "no") out.push(parseCondition("download", "is", search.download));
  return out.filter((c): c is ReplayCondition => c !== null);
}

export function describeValue(c: ReplayCondition) {
  const field = REPLAY_FIELDS[c.field];
  if (field.kind === "bool") return c.value === "yes" ? "yes" : "no";
  if (field.kind === "date") return `${String(c.value).replace("T", " ")} UTC`;
  if (field.kind === "number") return field.unit ? `${c.value} ${field.unit}` : String(c.value);
  return String(c.value);
}
