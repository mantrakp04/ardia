import { requireOptionalNativeModule } from "expo-modules-core";
import type { Subscription } from "./pageTypes";

export type SystemLinkSource = "web" | "system" | "shortcut" | "share" | "handoff" | "intent";

export type SystemLink = (
  | { kind: "open"; url: string }
  | { kind: "search"; query: string | null }
  | { kind: "voiceSearch" }
  | { kind: "incognito" }
  | { kind: "tab"; id: string }
  | { kind: "macTabs" }
  | { kind: "inbox" }
) & { source: SystemLinkSource };

type NativeLink = Omit<SystemLink, "query"> & { query?: string };

type SystemNative = {
  addListener(eventName: "onSystemLink", listener: (link: NativeLink) => void): Subscription;
  initialLink(): Promise<NativeLink | null>;
  setHidesFromRecents?(hidden: boolean): Promise<boolean>;
};

const native = requireOptionalNativeModule<SystemNative>("ArdiaPhoneSystem");

const normalize = (link: NativeLink): SystemLink => (link.kind === "search" ? { ...link, query: link.query ?? null } : link) as SystemLink;

export const system = {
  initialLink: async (): Promise<SystemLink | null> => {
    const link = native ? await native.initialLink() : null;
    return link ? normalize(link) : null;
  },
  setHidesFromRecents: async (hidden: boolean): Promise<boolean> => (native?.setHidesFromRecents ? native.setHidesFromRecents(hidden) : false),
  addLinkListener: (listener: (link: SystemLink) => void): Subscription =>
    native ? native.addListener("onSystemLink", (link) => listener(normalize(link))) : { remove() {} },
};
