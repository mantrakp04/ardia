export type EngineBookmark = { id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; c?: EngineBookmark[] };

export type BookmarkOp =
  | { op: "add"; id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; parent: string; index?: number; ifAbsent?: boolean }
  | { op: "move"; id: string; parent: string; index: number }
  | { op: "update"; id: string; t?: string; u?: string }
  | { op: "remove"; id: string };
