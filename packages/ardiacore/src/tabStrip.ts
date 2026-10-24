import { engineCall } from "./engine";
import { Cef } from "./native";

export type StripTab = {
  key: string | null;
  browser: number;
  index: number;
  active: boolean;
  pinned: boolean;
  group?: string | null;
};

export type StripGroup = {
  id: string;
  title: string;
  color: "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
  collapsed: boolean;
};

export type StripState = {
  strip: number;
  window: number;
  appWindow?: string;
  profile: string;
  tabs: StripTab[];
  activePickedOnClose?: boolean;
  groups?: StripGroup[];
  closed?: boolean;
};

export type TabStripTransaction = {
  rev: number;
  cmd: number | null;
  strips: StripState[];
  rejected?: boolean;
};

export type TabStripCommand =
  | { op: "activate"; strip: number; key: string }
  | { op: "arrange"; strip: number; keys: string[]; pinned: number }
  | {
      op: "group";
      strip: number;
      keys: string[];
      group: string | null;
      title?: string;
      color?: StripGroup["color"];
      collapsed?: boolean;
    };

let lastCommand = Math.floor(Math.random() * 1e6) * 1e3;

export function sendTabStripCommand(command: TabStripCommand): number {
  const id = ++lastCommand;
  void Cef.tabStripCommand(id, command);
  return id;
}

export const onTabStripTransaction = (listener: (tx: TabStripTransaction) => void) => Cef.addListener("onTabStrip", listener);

export const tabStrips = (): Promise<TabStripTransaction> => Cef.tabStrips();

export const lastTabClosesWindow = (): Promise<boolean> =>
  engineCall<{ closesWindow: boolean }>("ac_tabs_last_tab_policy", "").then((r) => r.closesWindow !== false, () => true);
