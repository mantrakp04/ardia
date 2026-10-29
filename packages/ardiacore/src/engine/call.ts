import { ArdiaError, ardiaError } from "@ardia/core";
import { requireNativeModule, type EventSubscription } from "expo-modules-core";
import type { EngineCalls, EngineEvents } from "./api";

export type CallName = keyof EngineCalls;
export type CallArgs<N extends CallName> = EngineCalls[N][0];
export type CallResult<N extends CallName> = EngineCalls[N][1];
export type EventName = keyof EngineEvents;

type DomainModule = {
  call(name: string, profile: string, args: string): Promise<string>;
  addListener(channel: string, listener: (event: { name: string; data: unknown }) => void): EventSubscription;
};

const modules = new Map<string, DomainModule>();

export function domainModule<Module = DomainModule>(domain: string): Module {
  let module = modules.get(domain);
  if (!module) {
    module = requireNativeModule<DomainModule>(`Ardia${domain[0]!.toUpperCase()}${domain.slice(1)}`);
    modules.set(domain, module);
  }
  return module as Module;
}

const domainOf = (name: string) => name.slice(0, name.indexOf("."));

export async function decodeReply<T>(reply: Promise<string>): Promise<T> {
  let json: string;
  try {
    json = await reply;
  } catch (error) {
    throw ardiaError(error);
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new ArdiaError("ERR_BAD_REPLY", "the reply isn't JSON");
  }
}

export async function call<N extends CallName>(name: N, ...[args]: {} extends CallArgs<N> ? [CallArgs<N>?] : [CallArgs<N>]): Promise<CallResult<N>> {
  const { profile = "", ...rest } = (args ?? {}) as { profile?: string };
  return decodeReply(domainModule(domainOf(name)).call(name.slice(name.indexOf(".") + 1), profile, JSON.stringify(rest)));
}

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const channels = new Map<string, EventSubscription>();

function deliver({ name, data }: { name: string; data: unknown }) {
  for (const listener of [...(listeners.get(name) ?? [])]) listener(data);
}

export function on<E extends EventName>(name: E, listener: (data: EngineEvents[E]) => void): EventSubscription {
  const domain = domainOf(name);
  let named = listeners.get(name);
  if (!named) listeners.set(name, (named = new Set()));
  const own = listener as Listener;
  named.add(own);
  if (!channels.has(domain)) channels.set(domain, domainModule(domain).addListener(domain, deliver));
  const subscribed = named;
  return {
    remove() {
      if (!subscribed.delete(own)) return;
      if (!subscribed.size && listeners.get(name) === subscribed) listeners.delete(name);
      if ([...listeners.keys()].some((other) => domainOf(other) === domain)) return;
      channels.get(domain)?.remove();
      channels.delete(domain);
    },
  };
}
