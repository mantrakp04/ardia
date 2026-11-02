import { nativeModule, type ShareAnchor } from "@ardia/shell";

export type { ShareAnchor };

const App = nativeModule("ArdiaApp");

export const sharePage = (url: string, title?: string | null, windowId?: string | null, anchor?: ShareAnchor | null) =>
  App.share(url, title ?? null, windowId ?? null, anchor ?? null);
export const sharePageVia = (service: string, url: string, title?: string | null, windowId?: string | null) =>
  App.shareVia(service, url, title ?? null, windowId ?? null);
