import { hostOf } from "./omnibox.ts";
import { PROVIDER_LIMITS, providerIcon, providerUrl, type ProviderRowInput } from "./providerRows.ts";

export type ProviderEntry = {
  keyword?: string;
  title?: string;
  global?: boolean;
  rows?: ProviderRowInput[];
  url?: string;
  suggest?: string;
};

export type ProviderConfig = {
  id: string;
  title: string;
  keyword?: string;
  global: boolean;
  rows: ProviderRowInput[];
  url?: string;
  suggest?: string;
};

export const PROVIDER_CONFIG_LIMITS = { providers: 32, rows: 200 } as const;

export const PROVIDER_ENTRY_KEYS = ["keyword", "title", "global", "rows", "url", "suggest"] as const;
const ROW_KEYS = new Set(["title", "url", "subtitle", "icon"]);
const KEYWORD = /^[^\s/?#:@.!]{1,32}$/u;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?[/?]/i;

export const QUERY_SLOT = "{query}";

export const isProviderKeyword = (value: unknown): value is string => typeof value === "string" && KEYWORD.test(value);

export function isRemoteEndpoint(template: string): boolean {
  if (!template.includes(QUERY_SLOT)) return false;
  const sample = template.split(QUERY_SLOT).join("q");
  return !!providerUrl(sample) && (/^https:\/\//i.test(sample) || LOOPBACK.test(sample));
}

const isTemplate = (template: string) => template.includes(QUERY_SLOT) && !!providerUrl(template.split(QUERY_SLOT).join("q"));

type Checked = { entry: ProviderEntry | null; problems: string[] };

function checkRows(rows: unknown, where: string, problems: string[]): ProviderRowInput[] | null {
  if (!Array.isArray(rows)) {
    problems.push(`${where}.rows must be a list of { title, url } rows`);
    return null;
  }
  if (rows.length > PROVIDER_CONFIG_LIMITS.rows) problems.push(`${where}.rows has more than ${PROVIDER_CONFIG_LIMITS.rows} rows; the rest are skipped`);
  const kept: ProviderRowInput[] = [];
  rows.slice(0, PROVIDER_CONFIG_LIMITS.rows).forEach((row, i) => {
    const at = `${where}.rows[${i}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) return void problems.push(`${at} must be an object with title and url`);
    const r = row as Record<string, unknown>;
    const unknown = Object.keys(r).filter((k) => !ROW_KEYS.has(k));
    if (unknown.length) return void problems.push(`${at}: ${unknown.join(", ")} isn't a row field (title, url, subtitle, icon)`);
    if (typeof r.title !== "string" || !r.title.trim()) return void problems.push(`${at}.title must be a string`);
    if (!providerUrl(r.url)) return void problems.push(`${at}.url must be an http or https URL`);
    if (r.subtitle !== undefined && typeof r.subtitle !== "string") return void problems.push(`${at}.subtitle must be a string`);
    if (r.icon !== undefined && r.icon !== null && !providerIcon(r.icon)) return void problems.push(`${at}.icon must be an https URL or a small data:image`);
    kept.push(r as ProviderRowInput);
  });
  return kept;
}

function checkEntry(value: unknown, where: string): Checked {
  const problems: string[] = [];
  const fail = (problem: string): Checked => ({ entry: null, problems: [...problems, `${where}${problem}`] });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(" must be an object");
  const v = value as Record<string, unknown>;
  const unknown = Object.keys(v).filter((k) => !(PROVIDER_ENTRY_KEYS as readonly string[]).includes(k));
  if (unknown.length) return fail(`: ${unknown.join(", ")} isn't a provider field (${PROVIDER_ENTRY_KEYS.join(", ")})`);
  if (v.keyword !== undefined && !isProviderKeyword(v.keyword)) return fail(".keyword must be 1 to 32 characters without spaces or / ? # : @ . !");
  if (v.title !== undefined && (typeof v.title !== "string" || !v.title.trim() || v.title.length > PROVIDER_LIMITS.providerTitle))
    return fail(`.title must be a string of 1 to ${PROVIDER_LIMITS.providerTitle} characters`);
  if (v.global !== undefined && typeof v.global !== "boolean") return fail(".global must be true or false");
  if (v.global === true && v.keyword !== undefined) return fail(": a provider with a keyword shows only in its keyword mode; drop global or the keyword");
  if (v.url !== undefined && (typeof v.url !== "string" || !isTemplate(v.url))) return fail(`.url must be an http or https URL containing ${QUERY_SLOT}`);
  if (v.url !== undefined && v.keyword === undefined) return fail(".url needs a keyword: it turns what you type after the keyword into a link");
  if (v.suggest !== undefined && (typeof v.suggest !== "string" || !isRemoteEndpoint(v.suggest)))
    return fail(`.suggest must be an https URL containing ${QUERY_SLOT}`);
  if (v.suggest !== undefined && v.keyword === undefined && v.global !== true)
    return fail(".suggest without a keyword needs global: true, since it sends everything you type to that server");
  const rows = v.rows === undefined ? undefined : checkRows(v.rows, where, problems);
  if (rows === null) return { entry: null, problems };
  if (rows === undefined && v.url === undefined && v.suggest === undefined) return fail(" needs rows, url or suggest");
  if (rows !== undefined && !rows.length && v.url === undefined && v.suggest === undefined) return { entry: null, problems };
  return { entry: { ...(v as ProviderEntry), ...(rows ? { rows } : {}) }, problems };
}

export function readProviderEntries(value: unknown, name = "omniboxProviders"): { entries: ProviderEntry[]; problems: string[] } {
  if (!Array.isArray(value)) return { entries: [], problems: [`${name} must be a list of providers`] };
  const entries: ProviderEntry[] = [];
  const problems: string[] = [];
  const keywords = new Set<string>();
  value.forEach((item, i) => {
    const where = `${name}[${i}]`;
    if (entries.length >= PROVIDER_CONFIG_LIMITS.providers) return void problems.push(`${where}: at most ${PROVIDER_CONFIG_LIMITS.providers} providers`);
    const checked = checkEntry(item, where);
    problems.push(...checked.problems);
    if (!checked.entry) return;
    const keyword = checked.entry.keyword?.toLowerCase();
    if (keyword && keywords.has(keyword)) return void problems.push(`${where}.keyword “${keyword}” is already used by another provider`);
    if (keyword) keywords.add(keyword);
    entries.push(checked.entry);
  });
  return { entries, problems };
}

export const isProviderEntryList = (value: unknown): value is ProviderEntry[] =>
  Array.isArray(value) && readProviderEntries(value).problems.length === 0;

function entryTitle(e: ProviderEntry): string {
  if (e.title) return e.title.trim();
  const host = hostOf((e.url ?? e.suggest ?? "").split(QUERY_SLOT).join("q"));
  return host || e.keyword || "Links";
}

export function providerConfigs(entries: readonly ProviderEntry[]): ProviderConfig[] {
  const ids = new Set<string>();
  return entries.map((e) => {
    const keyword = e.keyword?.toLowerCase();
    const title = entryTitle(e);
    let id = `config:${keyword ?? title.toLowerCase()}`;
    for (let n = 2; ids.has(id); n++) id = `config:${keyword ?? title.toLowerCase()}:${n}`;
    ids.add(id);
    return {
      id,
      title,
      ...(keyword ? { keyword } : {}),
      global: !keyword,
      rows: e.rows ?? [],
      ...(e.url ? { url: e.url } : {}),
      ...(e.suggest ? { suggest: e.suggest } : {}),
    };
  });
}
