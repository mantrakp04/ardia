import type { CaptionRegion } from "@ardia/shell";

export type { CaptionRegion };

export type WindowControls = {
  minimize(windowId: string): void;
  toggleMaximize(windowId: string): void;
  setCaptionRegions(windowId: string, regions: readonly CaptionRegion[]): void;
};

export const windowControls: WindowControls = {
  minimize() {},
  toggleMaximize() {},
  setCaptionRegions() {},
};
