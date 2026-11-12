import { DeviceEventEmitter, TurboModuleRegistry, type TurboModule } from "react-native";
import { nativeEventName } from "../events";

type EngineHost = TurboModule & {
  available(): boolean;
  hostCall(verb: string, argsJson: string, windowId: string): Promise<string>;
  engineCall(name: string, profile: string, argsJson: string): Promise<string>;
  removeProfileFolder?(userDataDir: string, folder: string): Promise<string>;
};

type EngineEvent = { topic?: unknown; json?: unknown };
type TopicListener = (payload: Record<string, unknown>) => void;

const MODULE = "ArdiaEngineHost";

let native: EngineHost | null | undefined;
let present: boolean | undefined;
const listeners = new Map<string, Set<TopicListener>>();
let subscribed = false;

const host = () => (native === undefined ? (native = TurboModuleRegistry.get<EngineHost>(MODULE)) : native);

export function engineAvailable(): boolean {
  if (present !== undefined) return present;
  try {
    present = host()?.available?.() === true;
  } catch {
    present = false;
  }
  return present;
}

export class EngineError extends Error {
  code = "ERR_ENGINE";
}

function decode<Result>(json: string): Result {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw Object.assign(new EngineError("the engine's reply isn't JSON"), { code: "ERR_BAD_REPLY" });
  }
  const failure = (parsed as { error?: unknown } | null)?.error;
  if (typeof failure === "string") throw new EngineError(failure);
  return parsed as Result;
}

export async function hostCall<Result = unknown>(verb: string, args: Record<string, unknown> = {}, windowId = ""): Promise<Result> {
  const engine = host();
  if (!engine) throw new EngineError("no engine");
  return decode<Result>(await engine.hostCall(verb, JSON.stringify(args), windowId));
}

export async function engineCallJson(name: string, profile: string, argsJson: string): Promise<string> {
  const engine = host();
  if (!engine) throw new EngineError("no engine");
  return engine.engineCall(name, profile, argsJson);
}

export type ProfileFolderRemoval = "removed" | "absent" | "inUse" | "partial" | "refused" | "failed" | "unsupported";

const REMOVALS: readonly ProfileFolderRemoval[] = ["removed", "absent", "inUse", "partial", "refused", "failed"];

export async function removeProfileFolder(userDataDir: string, folder: string): Promise<ProfileFolderRemoval> {
  const engine = host();
  if (typeof engine?.removeProfileFolder !== "function") return "unsupported";
  const outcome = await engine.removeProfileFolder(userDataDir, folder);
  return REMOVALS.find((known) => known === outcome) ?? "failed";
}

function deliver(event: EngineEvent) {
  if (typeof event?.topic !== "string" || typeof event.json !== "string") return;
  const wanted = listeners.get(event.topic);
  if (!wanted?.size) return;
  let payload: unknown;
  try {
    payload = JSON.parse(event.json);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  for (const listener of [...wanted]) listener(payload as Record<string, unknown>);
}

export function onEngineTopic(topic: string, listener: TopicListener): { remove(): void } {
  if (!subscribed) {
    subscribed = true;
    DeviceEventEmitter.addListener(nativeEventName(MODULE, "event"), deliver);
  }
  let wanted = listeners.get(topic);
  if (!wanted) listeners.set(topic, (wanted = new Set()));
  wanted.add(listener);
  return { remove: () => void wanted.delete(listener) };
}
