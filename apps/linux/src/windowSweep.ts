import type { BrowserState } from "../../browser/src/state/browser/store";
import { hostModuleMethod, type ArdiaHost } from "./host";

export const createLinuxWindowIds = (host: ArdiaHost, getState: () => Pick<BrowserState, "windows">) =>
  async () => {
    const live = await hostModuleMethod("ArdiaShell", "windowIds", host)() as string[];
    const { windows } = getState();
    return live.filter((id) => !!windows[id]);
  };
