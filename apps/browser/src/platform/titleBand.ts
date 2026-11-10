export type TitleBand = "caption" | "content";

export type TitleBands = {
  set(windowId: string, mode: TitleBand): void;
};

export const titleBands: TitleBands = {
  set() {},
};
