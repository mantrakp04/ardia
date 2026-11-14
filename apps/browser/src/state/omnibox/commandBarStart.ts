import type { JsonSchema } from "../../lib/jsonSchema";
import { isFields } from "../../lib/decode";
import type { TabPin } from "../browser/types";

export type CommandBarStart = { openTabs?: { hidePinned?: boolean; hideTopApps?: boolean; limit?: number } };

export const COMMAND_BAR_START_MAX_TABS = 20;
export const DEFAULT_COMMAND_BAR_TABS = 8;

const OPEN_TAB_KEYS = new Set(["hidePinned", "hideTopApps", "limit"]);

const isLimit = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= COMMAND_BAR_START_MAX_TABS;

function isOpenTabs(v: unknown): boolean {
  if (!isFields(v)) return false;
  return Object.entries(v).every(([key, value]) =>
    !OPEN_TAB_KEYS.has(key) ? false : key === "limit" ? isLimit(value) : typeof value === "boolean",
  );
}

export const isCommandBarStart = (v: unknown): v is CommandBarStart =>
  isFields(v) && Object.entries(v).every(([key, value]) => key === "openTabs" && isOpenTabs(value));

export const COMMAND_BAR_START_SCHEMA: JsonSchema = {
  type: "object",
  description: "What a new tab's command bar (⌘T) lists before you type. Set by plugins in config.json; there is no Settings row.",
  additionalProperties: false,
  properties: {
    openTabs: {
      type: "object",
      additionalProperties: false,
      properties: {
        hidePinned: { type: "boolean", description: "Leave out pinned tabs (the sidebar's pinned rows)." },
        hideTopApps: { type: "boolean", description: "Leave out Top Apps (the pinned tiles)." },
        limit: { type: "integer", minimum: 0, maximum: COMMAND_BAR_START_MAX_TABS, description: "How many open tabs to list; 0 lists none." },
      },
    },
  },
};

export function keepsOpenTab(start: CommandBarStart, pin: TabPin | null): boolean {
  if (!pin) return true;
  return pin.as === "row" ? !start.openTabs?.hidePinned : !start.openTabs?.hideTopApps;
}

export const commandBarTabLimit = (start: CommandBarStart): number => start.openTabs?.limit ?? DEFAULT_COMMAND_BAR_TABS;

export function commandBarStartFlags(start: unknown): Record<string, string> {
  const valid = isCommandBarStart(start) ? start : {};
  const limit = commandBarTabLimit(valid);
  return {
    setting_commandBarStart_hidePinned: valid.openTabs?.hidePinned ? "true" : "false",
    default_commandBarStart_hidePinned: "false",
    setting_commandBarStart_hideTopApps: valid.openTabs?.hideTopApps ? "true" : "false",
    default_commandBarStart_hideTopApps: "false",
    setting_commandBarStart_limit: String(limit),
    default_commandBarStart_limit: String(DEFAULT_COMMAND_BAR_TABS),
  };
}
