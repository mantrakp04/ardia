import type { ExternalAppAllowance, ExternalAppRequest } from "@ardia/ardiacore";
import type { DocumentsNative } from "@ardia/shell";
import type { ExternalAppsModule, ExternalHandler } from "../../nativeModuleTypes";
import { callError, isFields, isPrivateProfile, ok, type Engine, type Fields, type Handlers } from "./calling";

export type ExternalAppAsk = { id: string; url: string; origin: string | null; userGesture: boolean; offTheRecord: boolean };

type Pending = { url: string; scheme: string; profile: string; origin: string | null; rememberable: boolean };

type Saved = { version: 1; allowances: Record<string, Record<string, string[]>> };

const DOCUMENT = "external-app-allowances.json";
const PENDING_LIMIT = 50;
const SCHEME = /^[a-z][a-z0-9+.-]{0,63}$/;
const LOOPBACK = /^(localhost|.+\.localhost|127\.0\.0\.1|\[::1\])$/;

export const schemeOf = (url: string): string | null => {
  const colon = url.indexOf(":");
  if (colon <= 0) return null;
  const scheme = url.slice(0, colon).toLowerCase();
  return SCHEME.test(scheme) ? scheme : null;
};

export function trustworthyOrigin(origin: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+|\[[^\]]+\])(?::\d+)?$/i.exec(origin);
  if (!match) return false;
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!.toLowerCase();
  return scheme === "https" || (scheme === "http" && LOOPBACK.test(host));
}

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

export function windowsExternalApps(native: () => ExternalAppsModule | null, documents: () => Pick<DocumentsNative, "readDocument" | "writeDocument"> | null) {
  const pending = new Map<string, Pending>();
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
  const open = async (url: string) => {
    try {
      return (await native()?.open(url)) === true;
    } catch {
      return false;
    }
  };

  async function request(ask: ExternalAppAsk, profile: string): Promise<ExternalAppRequest | null> {
    const scheme = schemeOf(ask.url);
    if (!scheme || !ask.id) return null;
    const handler = await describe(scheme);
    const origin = ask.origin && ask.origin !== "null" ? ask.origin : null;
    const rememberable = !!handler && !!origin && !ask.offTheRecord && !isPrivateProfile(profile) && trustworthyOrigin(origin);
    if (handler && rememberable && ask.userGesture && allowed(profile, origin!, scheme)) {
      await open(ask.url);
      return null;
    }
    if (handler) {
      if (pending.size >= PENDING_LIMIT) pending.clear();
      pending.set(ask.id, { url: ask.url, scheme, profile, origin, rememberable });
    }
    const name = handler?.name ?? null;
    return {
      id: ask.id,
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
    if (!asked || !openIt) return false;
    if (remember && asked.rememberable && asked.origin) {
      const origins = (allowances().allowances[asked.profile] ??= {});
      origins[asked.origin] = [...new Set([...(origins[asked.origin] ?? []), asked.scheme])];
      store();
    }
    return open(asked.url);
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

  return { request, resolve, list, remove };
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
  if (typeof fields.id !== "string" || typeof fields.url !== "string") return null;
  return {
    id: fields.id,
    url: fields.url,
    origin: typeof fields.origin === "string" ? fields.origin : null,
    userGesture: fields.userGesture === true,
    offTheRecord: fields.offTheRecord === true,
  };
}
