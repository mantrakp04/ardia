import { moduleDefaults } from "../../defaults";
import { addNativeListener, emitNativeEvent, type EventSubscription } from "../../events";
import { noteMissing } from "../../missing";
import { engineCallJson, onEngineTopic } from "../host";
import { originalProfile, quietly, type Engine } from "./calling";
import { watchDownloads } from "./downloads";
import rows from "./forwarded.json";
import { domainCall, domainFunctions, domainsOf, moduleNameOf, topicRouter, type DomainCall } from "./tables";

const DOWNLOADS = "downloads";

const profilesSeen = new Set([""]);
let listening = false;
let watchingDownloads = false;

const engine: Engine = {
  call(name, profile, argsJson) {
    const base = originalProfile(profile);
    if (!profilesSeen.has(base)) {
      profilesSeen.add(base);
      if (watchingDownloads) quietly(watchDownloads(engine, base));
    }
    return engineCallJson(name, profile, argsJson);
  },
  emit(name, data) {
    const domain = name.slice(0, name.indexOf("."));
    emitNativeEvent(moduleNameOf(domain), domain, { name, data });
  },
  async missing(domain, verb, profile, argsJson) {
    const module = moduleNameOf(domain);
    const standIn = moduleDefaults[module]?.call as DomainCall | undefined;
    if (standIn) return standIn(verb, profile, argsJson);
    noteMissing(`${module}.call ${verb}`);
    return "null";
  },
};

const route = topicRouter(rows.topics, engine, (run) => setTimeout(run, 0));

function use(domain: string) {
  if (!listening) {
    listening = true;
    onEngineTopic("engine", route);
  }
  if (domain !== DOWNLOADS || watchingDownloads) return;
  watchingDownloads = true;
  for (const profile of profilesSeen) quietly(watchDownloads(engine, profile));
}

function moduleOf(domain: string, functions: Record<string, unknown> = {}): Record<string, unknown> {
  const call = domainCall(rows, engine, domain);
  return {
    ...functions,
    call: (verb: string, profile: string, argsJson: string) => {
      use(domain);
      return call(verb, profile, argsJson);
    },
    addListener: (event: string, listener: (payload: unknown) => void): EventSubscription => {
      use(domain);
      return addNativeListener(moduleNameOf(domain), event, listener);
    },
  };
}

const functions: Record<string, Record<string, unknown>> = {
  ...domainFunctions(engine),
  engine: {
    inputIdleSeconds: () => {
      noteMissing("ArdiaEngine.inputIdleSeconds");
      return 0;
    },
  },
};

export const engineDomainModules: Record<string, Record<string, unknown>> = Object.fromEntries(
  domainsOf(rows).map((domain) => [moduleNameOf(domain), moduleOf(domain, functions[domain])]),
);
