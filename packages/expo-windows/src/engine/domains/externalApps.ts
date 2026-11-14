import type { ExternalAppAllowance, ExternalAppRequest } from "@ardia/ardiacore";
import type { DocumentsNative, ExternalAppCountsNative, ExternalAppLaunches } from "@ardia/shell";
import type { ExternalAppsModule, ExternalHandler } from "../../nativeModuleTypes";
import { callError, isFields, isPrivateProfile, ok, type Engine, type Fields, type Handlers } from "./calling";

export type ExternalAppAsk = { id: string; url: string; origin: string | null; userGesture: boolean; offTheRecord: boolean };

type Pending = { ask: string; handler: ExternalHandler; url: string; scheme: string; profile: string; page: string; origin: string | null; rememberable: boolean };

type StillAsked = (page: string, id: string) => Promise<boolean>;
type DropAsk = (page: string, id: string) => void;

type Saved = { version: 1; allowances: Record<string, Record<string, string[]>> };

const DOCUMENT = "external-app-allowances.json";
const PENDING_LIMIT = 50;
const LONGEST_LINK = 32 * 1024;
const LONGEST_ORIGIN = 2048;
const ASK_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const SERIALIZED_ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;
const SCHEME = /^[a-z][a-z0-9+.-]{1,63}$/;
const LOOPBACK = /^((?:.+\.)?localhost\.?|127\.0\.0\.1|\[::1\])$/;

export const schemeOf = (url: string): string | null => {
  const colon = url.indexOf(":");
  if (colon <= 0) return null;
  const scheme = url.slice(0, colon).toLowerCase();
  return SCHEME.test(scheme) ? scheme : null;
};

export const serializedOrigin = (origin: unknown): string | null =>
  typeof origin === "string" && origin.length <= LONGEST_ORIGIN && SERIALIZED_ORIGIN.test(origin) ? origin : null;

export function trustworthyOrigin(origin: string): boolean {
  const match = SERIALIZED_ORIGIN.exec(origin);
  if (!match) return false;
  return match[1] === "https" || (match[1] === "http" && LOOPBACK.test(match[2]!));
}

const launches: ExternalAppLaunches = { opened: 0, refused: 0, automatic: 0 };

export const windowsExternalAppCounts: ExternalAppCountsNative = {
  takeLaunches() {
    const taken = { ...launches };
    launches.opened = launches.refused = launches.automatic = 0;
    return taken;
  },
};

const emptySaved = (): Saved => ({ version: 1, allowances: {} });

function readSaved(documents: Pick<DocumentsNative, "readDocument"> | null): Saved {
  try {
    const parsed: unknown = JSON.parse(documents?.readDocument(DOCUMENT) ?? "null");
    if (!isFields(parsed) || parsed.version !== 1 || !isFields(parsed.allowances)) return emptySaved();
    const allowances: Saved["allowances"] = {};
    for (const [profile, origins] of Object.entries(parsed.allowances)) {
      if (!isFields(origins)) continue;
      for (const [origin, schemes] of Object.entries(origins)) {
        const kept = Array.isArray(schemes) ? schemes.filter((s): s is string => typeof s === "string" && SCHEME.test(s)) : [];
        if (kept.length) (allowances[profile] ??= {})[origin] = [...new Set(kept)];
      }
    }
    return { version: 1, allowances };
  } catch {
    return emptySaved();
  }
}

export function windowsExternalApps(
  native: () => ExternalAppsModule | null,
  documents: () => Pick<DocumentsNative, "readDocument" | "writeDocument"> | null,
  stillAsked: StillAsked,
  dropAsk: DropAsk = () => {},
) {
  const pending = new Map<string, Pending>();
  const drop = (asked: Pending) => {
    try {
      dropAsk(asked.page, asked.ask);
    } catch {}
  };
  const forgottenProfiles = new Map<string, number>();
  let asksMade = 0;
  const generationOf = (profile: string) => forgottenProfiles.get(profile) ?? 0;
  let saved: Saved | undefined;
  const allowances = () => (saved ??= readSaved(documents()));
  const store = () => {
    try {
      documents()?.writeDocument(DOCUMENT, JSON.stringify(allowances()));
    } catch {}
  };
  const allowed = (profile: string, origin: string, scheme: string) => allowances().allowances[profile]?.[origin]?.includes(scheme) === true;
  const describe = async (scheme: string): Promise<ExternalHandler | null> => {
    try {
      return (await native()?.describe(scheme)) ?? null;
    } catch {
      return null;
    }
  };
  const open = async (url: string, handler: ExternalHandler) => {
    try {
      return (await native()?.open(url, handler.name, handler.path)) === true;
    } catch {
      return false;
    }
  };

  const asking = async (page: string, id: string) => {
    try {
      return (await stillAsked(page, id)) === true;
    } catch {
      return false;
    }
  };

  async function request(ask: ExternalAppAsk, profile: string, page: string): Promise<ExternalAppRequest | null> {
    const scheme = schemeOf(ask.url);
    if (!scheme || !ASK_ID.test(ask.id) || ask.url.length > LONGEST_LINK) return null;
    const generation = generationOf(profile);
    const handler = await describe(scheme);
    if (generationOf(profile) !== generation) {
      dropAsk(page, ask.id);
      return null;
    }
    const origin = serializedOrigin(ask.origin);
    const rememberable = !!handler && !!origin && !ask.offTheRecord && !isPrivateProfile(profile) && trustworthyOrigin(origin);
    if (handler && rememberable && ask.userGesture && allowed(profile, origin!, scheme)) {
      const opened = (await asking(page, ask.id)) && generationOf(profile) === generation && (await open(ask.url, handler));
      launches[opened ? "automatic" : "refused"] += 1;
      return null;
    }
    const id = `w${++asksMade}`;
    if (handler) {
      if (pending.size >= PENDING_LIMIT) {
        for (const asked of pending.values()) drop(asked);
        pending.clear();
      }
      pending.set(id, { ask: ask.id, handler, url: ask.url, scheme, profile, page, origin, rememberable });
    } else {
      dropAsk(page, ask.id);
    }
    const name = handler?.name ?? null;
    return {
      id,
      url: ask.url,
      scheme,
      origin,
      app: name,
      appPath: handler?.path ?? null,
      icon: handler?.icon ?? null,
      title: name ? `Open “${name}”?` : "No application is set to open this link",
      message: !name ? `Your PC doesn’t have an app for “${scheme}:” links.` : origin ? `${origin} wants to open this application.` : "This page wants to open this application.",
      remember: rememberable && name ? `Always allow ${origin} to open links of this type in ${name}` : null,
    };
  }

  async function resolve(id: string, openIt: boolean, remember: boolean): Promise<boolean> {
    const asked = pending.get(id);
    pending.delete(id);
    if (!asked) return false;
    if (!openIt) {
      drop(asked);
      return false;
    }
    const generation = generationOf(asked.profile);
    if (!(await asking(asked.page, asked.ask)) || generationOf(asked.profile) !== generation) {
      launches.refused += 1;
      return false;
    }
    if (remember && asked.rememberable && asked.origin) {
      const origins = (allowances().allowances[asked.profile] ??= {});
      origins[asked.origin] = [...new Set([...(origins[asked.origin] ?? []), asked.scheme])];
      store();
    }
    const opened = await open(asked.url, asked.handler);
    launches[opened ? "opened" : "refused"] += 1;
    return opened;
  }

  async function list(profile: string): Promise<ExternalAppAllowance[]> {
    const listed: ExternalAppAllowance[] = [];
    for (const [origin, schemes] of Object.entries(allowances().allowances[profile] ?? {})) {
      for (const scheme of schemes) {
        const handler = await describe(scheme);
        listed.push({ origin, scheme, app: handler?.name ?? null, icon: handler?.icon ?? null });
      }
    }
    return listed;
  }

  function remove(profile: string, origin: string, scheme: string) {
    const origins = allowances().allowances[profile];
    const kept = origins?.[origin]?.filter((s) => s !== scheme);
    if (!origins || !kept) return;
    if (kept.length) origins[origin] = kept;
    else delete origins[origin];
    if (!Object.keys(origins).length) delete allowances().allowances[profile];
    store();
  }

  function forget(id: string) {
    const asked = pending.get(id);
    pending.delete(id);
    if (asked) drop(asked);
  }

  function forgetPage(page: string) {
    for (const [id, asked] of pending) if (asked.page === page) (pending.delete(id), drop(asked));
  }

  function forgetProfile(profile: string) {
    forgottenProfiles.set(profile, generationOf(profile) + 1);
    for (const [id, asked] of pending) if (asked.profile === profile) (pending.delete(id), drop(asked));
    if (!allowances().allowances[profile]) return;
    delete allowances().allowances[profile];
    store();
  }

  return { request, resolve, list, remove, forget, forgetPage, forgetProfile };
}

export type ExternalApps = ReturnType<typeof windowsExternalApps>;

const appsOf = (engine: Engine): ExternalApps => {
  if (!engine.externalApps) throw callError("ERR_UNSUPPORTED", "This build has no Windows app links");
  return engine.externalApps;
};

export const externalAppCalls: Handlers = {
  resolveExternalApp: async (args, engine) => {
    await appsOf(engine).resolve(args.text("id"), args.bool("open"), args.optionalBool("remember") ?? false);
    return ok(null);
  },
  externalAppAllowances: async (args, engine) => ok(await appsOf(engine).list(args.profile)),
  removeExternalAppAllowance: async (args, engine) => {
    appsOf(engine).remove(args.profile, args.text("origin"), args.text("scheme"));
    return ok(null);
  },
};

export function readExternalAppAsk(data: unknown): ExternalAppAsk | null {
  if (!isFields(data)) return null;
  const fields: Fields = data;
  if (typeof fields.id !== "string" || !ASK_ID.test(fields.id) || typeof fields.url !== "string" || fields.url.length > LONGEST_LINK) return null;
  return {
    id: fields.id,
    url: fields.url,
    origin: serializedOrigin(fields.origin),
    userGesture: fields.userGesture === true,
    offTheRecord: fields.offTheRecord === true,
  };
}
