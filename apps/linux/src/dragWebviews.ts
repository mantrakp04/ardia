import { webviews as shared } from "../../browser/src/platform/webviews";
import type { ArdiaHost } from "./host";
import { hostSupports } from "./host.ts";

export const dragWebviews = (host?: ArdiaHost) => ({
  get: (tabId: string) => (hostSupports("ArdiaShell.dragPreviewPage", host) ? shared.get(tabId) : undefined),
});

export const webviews = dragWebviews();
