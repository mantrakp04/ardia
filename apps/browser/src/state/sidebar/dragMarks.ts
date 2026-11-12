import { create, type StoreApi } from "zustand";

export type DragMarks = {
  sources: Set<string>;
  dropInto: string | null;
  onto: string | null;
  landing: string | null;
  pins: boolean;
  pinCount: number;
  pinBefore: string | null;
  folded: string | null;
  folderTarget: string | null;
  folderAway: boolean;
};

const NO_MARKS: DragMarks = { sources: new Set(), dropInto: null, onto: null, landing: null, pins: false, pinCount: 0, pinBefore: null, folded: null, folderTarget: null, folderAway: false };

export const createDragMarks = () => create<DragMarks>()(() => NO_MARKS);

export const noDragMarks = createDragMarks();

export const dragMarksOf = (marks: StoreApi<DragMarks>) => marks.getState();

export const markDrag = (marks: StoreApi<DragMarks>, patch: Partial<DragMarks>) => marks.setState(patch);
