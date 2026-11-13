import { requireNativeModule } from "expo-modules-core";
import type { BlockingCategory, BlockingEvent, BlockingState, MyFiltersResult, Subscription } from "./pageTypes";

type BlockingNative = {
  addListener(eventName: "onBlockingEvent", listener: (event: BlockingEvent) => void): Subscription;
  state(): Promise<BlockingState>;
  setEnabled(enabled: boolean): Promise<void>;
  setCategory(category: BlockingCategory, enabled: boolean): Promise<void>;
  isEnabledForSite(url: string, isPrivate: boolean): Promise<boolean>;
  setEnabledForSite(url: string, enabled: boolean, isPrivate: boolean): Promise<string | null>;
  setListEnabled(id: string, enabled: boolean): Promise<void>;
  removeList(id: string): Promise<void>;
  updateLists(): Promise<void>;
  resetToDefaults(): Promise<void>;
  addCustomList(url: string): Promise<string>;
  setMyFilters(text: string): Promise<MyFiltersResult>;
  blockedCount(pageId: string): Promise<number | null>;
};

let loaded: BlockingNative | undefined;
const native = () => (loaded ??= requireNativeModule<BlockingNative>("ArdiaBlocking"));

export const blocking = {
  state: () => native().state(),
  setEnabled: (enabled: boolean) => native().setEnabled(enabled),
  setCategory: (category: BlockingCategory, enabled: boolean) => native().setCategory(category, enabled),
  isEnabledForSite: (url: string, isPrivate = false) => native().isEnabledForSite(url, isPrivate),
  setEnabledForSite: (url: string, enabled: boolean, isPrivate = false) => native().setEnabledForSite(url, enabled, isPrivate),
  setListEnabled: (id: string, enabled: boolean) => native().setListEnabled(id, enabled),
  removeList: (id: string) => native().removeList(id),
  updateLists: () => native().updateLists(),
  resetToDefaults: () => native().resetToDefaults(),
  addCustomList: (url: string) => native().addCustomList(url),
  setMyFilters: (text: string) => native().setMyFilters(text),
  blockedCount: (pageId: string) => native().blockedCount(pageId),
  addListener: (listener: (event: BlockingEvent) => void): Subscription => native().addListener("onBlockingEvent", listener),
};
