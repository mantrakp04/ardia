import { create } from "zustand";

type Lifecycle = {
  discarded: Record<string, true>;
  batterySaver: boolean;
};

export const useLifecycle = create<Lifecycle>()(() => ({ discarded: {}, batterySaver: false }));

export const useIsSleeping = (tabId: string) => useLifecycle((l) => !!l.discarded[tabId]);

export const isSleeping = (tabId: string) => !!useLifecycle.getState().discarded[tabId];
