export type CaptionRegion = readonly [left: number, top: number, rightInset: number, height: number];

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
