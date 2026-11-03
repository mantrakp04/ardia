import { isFields } from "../../lib/decode";
import { formatUrl, webUrl } from "../../lib/urlParts";
import { registerOmniboxProvider, type ProviderRow } from "../omnibox/providers";
import { DECIDE_DEADLINE_MS } from "./eventNames";
import type { HookSpec } from "./hookFile";
import { activeHook, onHooksChanged, useHookRules } from "./hookRules";
import { onServedHooksChanged, requestDecision, servedHooks } from "./decideSocket";

export const MAX_PROVIDER_ROWS = 8;
const TEXT_LIMIT = 2048;

const registered = new Map<string, () => void>();

export function providerRows(answer: unknown): ProviderRow[] {
  if (!Array.isArray(answer)) return [];
  const rows: ProviderRow[] = [];
  for (const item of answer) {
    if (rows.length >= MAX_PROVIDER_ROWS) break;
    if (!isFields(item) || typeof item.title !== "string" || !item.title.trim() || typeof item.url !== "string") continue;
    const url = webUrl(item.url);
    if (!url) continue;
    rows.push({
      title: item.title.slice(0, 300),
      url: formatUrl(url),
      ...(typeof item.subtitle === "string" ? { subtitle: item.subtitle.slice(0, 300) } : {}),
      ...(typeof item.icon === "string" && /^(https?:|sf:)/.test(item.icon) ? { icon: item.icon } : {}),
    });
  }
  return rows;
}

function providerFor(hook: HookSpec) {
  const omnibox = hook.omnibox!;
  return {
    id: `hook:${hook.name}`,
    title: omnibox.title,
    ...(omnibox.keyword ? { keyword: omnibox.keyword } : {}),
    query: async (text: string, signal: AbortSignal) => {
      const answer = await requestDecision(hook, "omnibox.query", { text: text.slice(0, TEXT_LIMIT), keyword: omnibox.keyword }, DECIDE_DEADLINE_MS["omnibox.query"], signal);
      return signal.aborted ? [] : providerRows(answer);
    },
  };
}

function sync() {
  const served = new Set(servedHooks().map((h) => `${h.name}\n${h.revision}`));
  const wanted = new Map<string, HookSpec>();
  for (const hook of useHookRules.getState().hooks) {
    if (hook.omnibox && served.has(`${hook.name}\n${hook.revision}`) && activeHook(hook)) wanted.set(`${hook.name}\n${hook.revision}`, hook);
  }
  for (const [key, unregister] of registered) {
    if (wanted.has(key)) continue;
    unregister();
    registered.delete(key);
  }
  for (const [key, hook] of wanted) {
    if (registered.has(key)) continue;
    try {
      registered.set(key, registerOmniboxProvider(providerFor(hook)));
    } catch (error) {
      console.warn(`[automation] hook ${hook.name} can't be an address bar provider`, error);
    }
  }
}

let started = false;

export function startOmniboxHooks() {
  if (started) return;
  started = true;
  onServedHooksChanged(sync);
  onHooksChanged(sync);
  sync();
}
