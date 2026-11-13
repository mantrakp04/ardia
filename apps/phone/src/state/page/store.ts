import { create } from "zustand";
import type { NightShadeMode } from "./pageMenu";
import type { PressTarget } from "./pagePrompts";

export type MenuSite = { host: string | null; nightShade: NightShadeMode; blockersEnabled: boolean };

export type Press = { tabId: string; target: PressTarget; x: number; y: number };

type PageUi = {
  menuOpen: boolean;
  menuSite: MenuSite | null;
  titleFeedback: string | null;
  findOpen: boolean;
  findQuery: string;
  readerTabId: string | null;
  press: Press | null;
  zoomLevels: number[];
};

export const usePageUi = create<PageUi>()(() => ({
  menuOpen: false,
  menuSite: null,
  titleFeedback: null,
  findOpen: false,
  findQuery: "",
  readerTabId: null,
  press: null,
  zoomLevels: [],
}));

export const pageUi = () => usePageUi.getState();
