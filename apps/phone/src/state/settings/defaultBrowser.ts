import { create } from "zustand";
import { defaultBrowser, openAppSettings, type DefaultBrowserStatus } from "../../platform/defaultBrowser";
import type { DefaultBrowserAction } from "./settingsRules";
import { settled } from "../pages/store";

export const useDefaultBrowser = create<{ status: DefaultBrowserStatus | null }>()(() => ({ status: null }));

export const defaultBrowserStatus = () => useDefaultBrowser.getState().status;

export async function refreshDefaultBrowser(): Promise<DefaultBrowserStatus | null> {
  const status = await settled(() => defaultBrowser.status(), null);
  useDefaultBrowser.setState({ status });
  return status;
}

export async function askForDefaultBrowser(does: DefaultBrowserAction | null): Promise<DefaultBrowserStatus | null> {
  if (does === "askForRole") await settled(() => defaultBrowser.requestRole(), false);
  else if (does === "openDefaultApps") await settled(() => defaultBrowser.openDefaultAppsSettings(), undefined);
  else if (does === "openAppSettings") await settled(() => openAppSettings(), undefined);
  return refreshDefaultBrowser();
}
