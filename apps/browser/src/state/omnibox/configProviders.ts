import {
  fixupUrl,
  hostOf,
  matchProviderRows,
  providerApprovalKey,
  providerConfigs,
  QUERY_SLOT,
  type KeywordProvider,
  type ProviderConfig,
  type ProviderEntry,
} from "@ardia/core";
import { isProviderApproved } from "./providerApproval";
import type { OmniboxProvider, ProviderRow } from "./providers";
import { fetchRemoteRows } from "./remoteProvider";

export type ActiveProvider = OmniboxProvider & { host?: string; template?: string; sendsInput: boolean };

export type PendingProvider = { key: string; title: string; keyword: string | null; global: boolean; endpoint: string | null };

type Built = { config: ProviderConfig; key: string };

const builtFor = new WeakMap<readonly ProviderEntry[], Built[]>();

function built(entries: readonly ProviderEntry[]): Built[] {
  let list = builtFor.get(entries);
  if (!list) {
    const configs = providerConfigs(entries);
    list = configs.map((config, i) => ({ config, key: providerApprovalKey(entries[i]) }));
    builtFor.set(entries, list);
  }
  return list;
}

const needsApproval = (c: ProviderConfig) => c.global || !!c.suggest;

const looksLikeAddress = (text: string) => !!fixupUrl(text) || /^[a-z][a-z0-9+.-]*:/i.test(text);

function configProvider(c: ProviderConfig, partition: string, remote: boolean): ActiveProvider {
  const suggest = remote ? c.suggest : undefined;
  return {
    id: c.id,
    title: c.title,
    ...(c.keyword ? { keyword: c.keyword } : {}),
    ...(c.url ? { host: hostOf(c.url.split(QUERY_SLOT).join("q")), template: c.url.split(QUERY_SLOT).join("%s") } : {}),
    sendsInput: !!suggest,
    async query(text, signal) {
      const local: ProviderRow[] = c.global && !text.trim() ? [] : matchProviderRows(c.rows, text);
      if (!suggest || !text.trim() || (c.global && looksLikeAddress(text.trim()))) return local;
      const fetched = await fetchRemoteRows(suggest, text.trim(), partition, signal, c.url);
      return [...local, ...fetched];
    },
  };
}

export function configProviders(entries: readonly ProviderEntry[], { partition, privateContext }: { partition: string; privateContext: boolean }): ActiveProvider[] {
  const out: ActiveProvider[] = [];
  for (const { config, key } of built(entries)) {
    const approved = !needsApproval(config) || isProviderApproved(key);
    if (config.global && !approved) continue;
    const remote = !!config.suggest && approved && !privateContext;
    if (config.global && config.suggest && !remote && !config.rows.length) continue;
    out.push(configProvider(config, partition, remote));
  }
  return out;
}

export function pendingConfigProviders(entries: readonly ProviderEntry[]): PendingProvider[] {
  return built(entries)
    .filter(({ config, key }) => needsApproval(config) && !isProviderApproved(key))
    .map(({ config, key }) => ({ key, title: config.title, keyword: config.keyword ?? null, global: config.global, endpoint: config.suggest ? hostOf(config.suggest.split(QUERY_SLOT).join("q")) : null }));
}

export const keywordProviders = (providers: readonly ActiveProvider[]): KeywordProvider[] =>
  providers.flatMap((p) => (p.keyword ? [{ id: p.id, title: p.title, keyword: p.keyword, ...(p.host ? { host: p.host } : {}), ...(p.template ? { url: p.template } : {}) }] : []));
