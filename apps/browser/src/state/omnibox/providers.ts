import { isProviderKeyword } from "@ardia/core";
import { create } from "zustand";

export type ProviderRow = { title: string; url: string; subtitle?: string; icon?: string | null; badge?: string };

export type OmniboxProvider = { id: string; title: string; keyword?: string; query(text: string, signal: AbortSignal): Promise<ProviderRow[]> };

export const useRegisteredProviders = create<{ list: readonly OmniboxProvider[] }>()(() => ({ list: [] }));

export function registerOmniboxProvider(provider: OmniboxProvider): () => void {
  if (!provider.id || typeof provider.query !== "function") throw new Error("An omnibox provider needs an id and a query function");
  if (provider.keyword !== undefined && !isProviderKeyword(provider.keyword))
    throw new Error(`Omnibox provider ${provider.id}: keyword must be 1 to 32 characters without spaces or / ? # : @ . !`);
  useRegisteredProviders.setState((s) => ({ list: [...s.list.filter((p) => p.id !== provider.id), provider] }));
  return () => useRegisteredProviders.setState((s) => ({ list: s.list.filter((p) => p !== provider) }));
}
