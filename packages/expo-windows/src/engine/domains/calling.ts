import type { DomainModule } from "@ardia/ardiacore";
import type { ImportHost } from "../../import/host";

export type Fields = Record<string, unknown>;

export type Engine = {
  call: DomainModule["call"];
  host(verb: string, args?: Fields): Promise<Fields>;
  profileDataFolder(): string | null;
  removeProfileFolder(folder: string): Promise<string>;
  emit(name: string, data: unknown): void;
  missing(domain: string, verb: string, profile: string, argsJson: string): Promise<string>;
  desktop?: Desktop;
};

export type SaveRequest = { name: string; extension: string; kind: string; message: string };

export type PowerReading = { onBattery?: unknown; batteryPercent?: unknown; batterySaver?: unknown; memoryLoad?: unknown; physicalMemory?: unknown };

export type Desktop = {
  saveFile(request: SaveRequest): Promise<string | null>;
  pickFolder(prompt: string): Promise<string | null>;
  readText: ImportHost["readTextWithin"];
  readBase64: ImportHost["readBase64Within"];
  power(): PowerReading | null;
  every(ms: number, run: () => void): void;
};

export type CallError = Error & { code: string };

export const callError = (code: string, message: string): CallError => Object.assign(new Error(message), { code });

export class BadArgs extends Error {}

export const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === "string";
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

export function readArgs(profile: string, json: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  if (!isFields(parsed)) throw new BadArgs("the arguments aren't a JSON object");
  const values = parsed;

  const optional = <Value>(key: string, kind: string, is: (value: unknown) => value is Value): Value | undefined => {
    const raw = values[key];
    if (raw === undefined || raw === null) return undefined;
    if (!is(raw)) throw new BadArgs(`${key} isn't ${kind}`);
    return raw;
  };
  const required = <Value>(key: string, kind: string, is: (value: unknown) => value is Value): Value => {
    const value = optional(key, kind, is);
    if (value === undefined) throw new BadArgs(`${key} is missing`);
    return value;
  };

  return {
    profile,
    json,
    values,
    text: (key: string) => required(key, "a string", isText),
    optionalText: (key: string) => optional(key, "a string", isText),
    bool: (key: string) => required(key, "a boolean", isBool),
    optionalBool: (key: string) => optional(key, "a boolean", isBool),
    double: (key: string) => required(key, "a number", isNumber),
    optionalDouble: (key: string) => optional(key, "a number", isNumber),
    dict: (key: string) => required(key, "an object", isFields),
    strings: (key: string) => required(key, "a list of strings", isTexts),
    choice: <Choice extends string>(key: string, choices: readonly Choice[]): Choice => {
      const raw = required(key, "a string", isText);
      const chosen = choices.find((choice) => choice === raw);
      if (chosen === undefined) throw new BadArgs(`${key} isn't one of the values it takes`);
      return chosen;
    },
  };
}

export type Args = ReturnType<typeof readArgs>;
export type Handler = (args: Args, engine: Engine) => Promise<string>;
export type Handlers = Record<string, Handler>;

export const ok = (value?: unknown): string => JSON.stringify(value ?? null);

const described = (error: unknown) => (typeof error === "string" ? error : (JSON.stringify(error) ?? String(error)));

async function engineJson(engine: Engine, name: string, profile: string, argsJson: string): Promise<string> {
  let json: unknown;
  try {
    json = await engine.call(name, profile, argsJson);
  } catch (error) {
    throw callError("ERR_ENGINE", error instanceof Error ? error.message : String(error));
  }
  if (typeof json !== "string") throw callError("ERR_ENGINE", "bad reply from the engine");
  return json;
}

export async function passed(engine: Engine, name: string, profile: string, argsJson: string): Promise<string> {
  const json = await engineJson(engine, name, profile, argsJson);
  if (!json.includes('"error"')) return json;
  let reply: unknown;
  try {
    reply = JSON.parse(json);
  } catch {
    throw callError("ERR_ENGINE", "the engine's reply isn't JSON");
  }
  if (isFields(reply) && Object.hasOwn(reply, "error")) throw callError("ERR_ENGINE", described(reply.error));
  return json;
}

export async function served(engine: Engine, name: string, profile: string, args: Fields = {}): Promise<Fields> {
  const json = await engineJson(engine, name, profile, JSON.stringify(args));
  let reply: unknown;
  try {
    reply = JSON.parse(json);
  } catch {
    reply = undefined;
  }
  if (!isFields(reply)) throw callError("ERR_ENGINE", "bad reply from the engine");
  if (Object.hasOwn(reply, "error")) throw callError("ERR_ENGINE", described(reply.error));
  return reply;
}

export const quietly = (work: Promise<unknown>) => void work.catch(() => {});

const PRIVATE_SESSION = "incognito";

export const isPrivateProfile = (profile: string) => profile.startsWith(PRIVATE_SESSION);

export function originalProfile(profile: string): string {
  if (!isPrivateProfile(profile)) return profile;
  const at = profile.indexOf("@");
  return at < 0 ? "" : profile.slice(at + 1);
}
