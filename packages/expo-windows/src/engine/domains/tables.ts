import type { DomainModule } from "@ardia/ardiacore";
import { autofillCalls, saveCard } from "./autofill";
import { BadArgs, callError, isFields, passed, readArgs, type Engine, type Fields, type Handlers } from "./calling";
import { downloadCalls, downloadChanged } from "./downloads";
import { engineCalls, searchCalls } from "./engineCalls";
import { extensionCalls } from "./extensions";
import { bookmarkCalls, exportPasswords } from "./exports";
import { systemState } from "./systemState";
import { unpackedCalls } from "./unpacked";
import { faviconCalls } from "./favicons";
import { passwordCalls, savePassword, updatePassword } from "./passwords";
import { profileCalls } from "./profiles";
import { siteCalls } from "./sites";
import { webViewCalls } from "./webView";

export type Rows = {
  forwarded: Record<string, Record<string, string>>;
  awaitingEngine?: Record<string, Record<string, string>>;
  missing: Record<string, string[]>;
  topics: Record<string, string>;
};

export type DomainCall = DomainModule["call"];

export const reproduced: Record<string, Handlers> = {
  autofill: autofillCalls,
  bookmarks: bookmarkCalls,
  downloads: downloadCalls,
  engine: { ...engineCalls, systemState },
  extensions: { ...extensionCalls, ...unpackedCalls },
  favicons: faviconCalls,
  passwords: { ...passwordCalls, export: exportPasswords },
  profiles: profileCalls,
  search: searchCalls,
  sites: siteCalls,
  webView: webViewCalls,
};

export const moduleNameOf = (domain: string) => `Ardia${domain[0]!.toUpperCase()}${domain.slice(1)}`;

export const domainsOf = (rows: Rows) => [...new Set([...Object.keys(rows.forwarded), ...Object.keys(rows.missing), ...Object.keys(reproduced)])].sort();

const own = <Value>(table: Record<string, Value> | undefined, key: string) => (table && Object.hasOwn(table, key) ? table[key] : undefined);

export function domainCall(rows: Rows, engine: Engine, domain: string): DomainCall {
  return async (verb, profile, argsJson) => {
    const forwardedTo = own(rows.forwarded[domain], verb);
    const handler = own(reproduced[domain], verb);
    if (forwardedTo === undefined && !handler && !rows.missing[domain]?.includes(verb)) throw callError("ERR_UNKNOWN_CALL", `${domain}.${verb} isn't a call`);
    try {
      const args = readArgs(profile, argsJson);
      if (forwardedTo !== undefined) return await passed(engine, forwardedTo, args.profile, args.json);
      if (handler) return await handler(args, engine);
      return await engine.missing(domain, verb, profile, argsJson);
    } catch (error) {
      if (error instanceof BadArgs) throw callError("ERR_BAD_ARGS", `${domain}.${verb}: ${error.message}`);
      throw error;
    }
  };
}

export const domainFunctions = (engine: Engine): Record<string, Record<string, unknown>> => ({
  autofill: {
    saveCard: (profile: string, card: Fields | null, number: string | null) => saveCard(engine, profile, card, number),
  },
  passwords: {
    save: (profile: string, origin: string, username: string, password: string) => savePassword(engine, profile, origin, username, password),
    update: (profile: string, origin: string, username: string, newUsername: string | null, newPassword: string | null) =>
      updatePassword(engine, profile, origin, username, newUsername, newPassword),
  },
});

type Forward = { name: string; data: Fields; same: string };

export function topicRouter(topics: Record<string, string>, engine: Engine, later: (run: () => void) => void) {
  let pending: Forward[] | null = null;
  const flush = () => {
    const forwards = pending ?? [];
    pending = null;
    for (const forward of forwards) engine.emit(forward.name, forward.data);
  };
  return (event: Fields) => {
    const { topic } = event;
    if (typeof topic !== "string") return;
    const payload = isFields(event.payload) ? event.payload : {};
    if (topic === "downloads.changed") return downloadChanged(engine, payload);
    const name = own(topics, topic);
    if (name === undefined) return;
    const forward = { name, data: payload, same: `${name}\n${JSON.stringify(payload)}` };
    if (pending) {
      if (pending[pending.length - 1]?.same !== forward.same) pending.push(forward);
      return;
    }
    pending = [forward];
    later(flush);
  };
}
