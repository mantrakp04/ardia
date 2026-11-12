import { isFields, served, type Engine, type Fields } from "./calling";
import { loginOrigin } from "./passwords";

const ORIGINAL = "";
const ZOOM_CHECKS = 20;
const ZOOM_CHECK_MS = 100;

type Step = [label: string, run: (engine: Engine) => Promise<boolean>];

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const text = (value: unknown) => (typeof value === "string" ? value : "");

async function listed(engine: Engine, name: string, key: string): Promise<unknown[] | null> {
  const items = (await served(engine, name, ORIGINAL))[key];
  return Array.isArray(items) ? items : null;
}

async function entries(engine: Engine, name: string, key: string, keep: (item: Fields) => boolean): Promise<Fields[] | null> {
  const items = await listed(engine, name, key);
  return items && items.filter(isFields).filter(keep);
}

async function clearEach(engine: Engine, name: string, key: string, clear: (item: Fields) => Promise<unknown>, keep: (item: Fields) => boolean = () => true) {
  const items = await entries(engine, name, key, keep);
  if (!items) return false;
  for (const item of items) await clear(item).catch(() => {});
  const left = await entries(engine, name, key, keep);
  return left !== null && left.length === 0;
}

async function cleared(engine: Engine, types: string[]) {
  const { ok } = await served(engine, "ac_browsing_data_clear", ORIGINAL, { types, since: 0 });
  return ok === true;
}

async function passwords(engine: Engine) {
  const remove = (item: Fields) => served(engine, "ac_passwords_remove", ORIGINAL, { origin: loginOrigin(text(item.origin)), username: text(item.username) });
  const deleted = await clearEach(engine, "ac_passwords_list", "passwords", remove);
  const origins = (await listed(engine, "ac_passwords_exceptions", "origins")) ?? [];
  for (const origin of origins) await served(engine, "ac_passwords_allow", ORIGINAL, { origin: loginOrigin(text(origin)) }).catch(() => {});
  const left = await listed(engine, "ac_passwords_exceptions", "origins");
  return deleted && left !== null && left.length === 0;
}

const removeEntry = (engine: Engine) => (item: Fields) => served(engine, "ac_autofill_remove", ORIGINAL, { id: text(item.id) });

const running = (item: Fields) => item.mayModify !== false && item.enabled === true;

async function siteSettings(engine: Engine) {
  const origins = (await served(engine, "ac_site_settings_origins", ORIGINAL)).origins;
  for (const origin of Array.isArray(origins) ? origins : []) await served(engine, "ac_site_settings_reset", ORIGINAL, { origin: text(origin) }).catch(() => {});
  const left = (await served(engine, "ac_site_settings_origins", ORIGINAL)).origins;
  return Array.isArray(left) && left.length === 0;
}

async function zoomHosts(engine: Engine): Promise<string[]> {
  const { levels } = await served(engine, "ac_zoom_list", ORIGINAL);
  return isFields(levels) ? Object.keys(levels) : [];
}

async function zoomLevels(engine: Engine) {
  for (const host of await zoomHosts(engine)) await served(engine, "ac_zoom_set", ORIGINAL, { host: host.toLowerCase(), level: 0 }).catch(() => {});
  for (let check = 0; check <= ZOOM_CHECKS; check++) {
    if (check) await later(ZOOM_CHECK_MS);
    if (!(await zoomHosts(engine)).length) return true;
  }
  return false;
}

const STEPS: Step[] = [
  ["history, cookies and cache", (engine) => cleared(engine, ["history", "siteData", "cache", "downloads"])],
  ["autocomplete entries", (engine) => cleared(engine, ["formData", "siteSettings"])],
  ["passwords", passwords],
  ["addresses", (engine) => clearEach(engine, "ac_autofill_addresses", "addresses", removeEntry(engine))],
  ["cards", (engine) => clearEach(engine, "ac_autofill_cards", "cards", removeEntry(engine))],
  ["extensions", (engine) => clearEach(engine, "ac_extensions_list", "extensions", (item) => served(engine, "ac_extensions_set_enabled", ORIGINAL, { id: text(item.id), enabled: false }), running)],
  ["site settings", siteSettings],
  ["zoom levels", zoomLevels],
];

export async function deleteOriginalProfileData(engine: Engine): Promise<string[]> {
  const remaining: string[] = [];
  for (const [label, run] of STEPS) {
    const done = await run(engine).catch(() => false);
    if (!done) remaining.push(label);
  }
  return remaining;
}
