import type { BrowserCommand } from "./browserCommand";

export type CommandEvent = {
  command: BrowserCommand;
  arg: string | null;
  windowId: string | null;
  focusGeneration?: number | null;
};
