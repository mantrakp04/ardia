import { create } from "zustand";
import { defaultBrowser, type DefaultBrowserStatus } from "../../platform/defaultBrowser";
import { settled } from "../pages/store";

export const useDefaultBrowser = create<{ status: DefaultBrowserStatus | null }>()(() => ({ status: null }));

export const defaultBrowserStatus = () => useDefaultBrowser.getState().status;

export async function refreshDefaultBrowser(): Promise<DefaultBrowserStatus | null> {
  const status = await settled(() => defaultBrowser.status(), null);
  useDefaultBrowser.setState({ status });
  return status;
}

export async function askForDefaultBrowser(): Promise<DefaultBrowserStatus | null> {
  const status = defaultBrowserStatus();
  if (status?.canAsk) await settled(() => defaultBrowser.requestRole(), false);
  else await settled(() => defaultBrowser.openDefaultAppsSettings(), undefined);
  return refreshDefaultBrowser();
}
