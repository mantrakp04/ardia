import { setAppScheme } from "@ardia/core";
import { systemInfo, type SystemInfo } from "@ardia/shell";

export const DEFAULT_PRODUCT = "Ardia";
const UPSTREAM_HOST = "ardia.dev";

function readInfo(): Partial<SystemInfo> {
  try {
    return systemInfo() ?? {};
  } catch {
    return {};
  }
}

function urlOf(url: string | null | undefined): URL | null {
  try {
    return url?.trim() ? new URL(url) : null;
  } catch {
    return null;
  }
}

const info = readInfo();
const telemetry = urlOf(info.telemetryURL);
const feed = urlOf(info.updateFeedURL);
const switches = urlOf(info.switchesURL);

export const PRODUCT = info.appName?.trim() || DEFAULT_PRODUCT;

export const APP_SCHEME = setAppScheme(PRODUCT);

export const SERVICES = {
  telemetryHost: telemetry?.host || UPSTREAM_HOST,
  updateHost: feed?.host || UPSTREAM_HOST,
  switchFile: switches?.host ? `${switches.host}${switches.pathname === "/" ? "" : switches.pathname}` : `${UPSTREAM_HOST}/switches.json`,
};
