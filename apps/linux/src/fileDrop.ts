import type { DroppedItem, DropUpdate } from "../../../packages/shell/src/system";

export const MAX_DROPPED_URLS = 50;
const MAX_DROP_TEXT = 8192;
const DRAG_TYPES = new Set(["Files", "text/uri-list", "text/plain"]);

export const acceptsDrag = (types: readonly string[]) => types.some((type) => DRAG_TYPES.has(type));

export function parseUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const fileUrl = (url: string) => /^file:/i.test(url);

export function domDropItems({ uriList, text }: { uriList: string; text: string }): DroppedItem[] {
  const urls = parseUriList(uriList).filter((url) => !fileUrl(url)).slice(0, MAX_DROPPED_URLS);
  if (urls.length) return urls.map((url) => ({ kind: "url" as const, url }));
  const plain = text.trim();
  if (!plain || plain.length > MAX_DROP_TEXT || parseUriList(plain).every(fileUrl)) return [];
  return [{ kind: "text", text: plain }];
}

export const dragCount = (types: readonly string[], files: number) => (files > 0 ? files : types.some((type) => type !== "Files" && DRAG_TYPES.has(type)) ? 1 : 0);

export const validFileUrl = (url: unknown): url is string => typeof url === "string" && /^file:\/\/\/[^/]/i.test(url) && url.length <= 16384;

export type DropPoint = { x: number; y: number };
export type DropPayload = { uriList: string; text: string; fileNames: string[] };

export type DropController = {
  over(point: DropPoint, count: number): void;
  leave(): void;
  drop(point: DropPoint, payload: DropPayload): Promise<void>;
  readonly inside: boolean;
};

export function createDropController(emit: (update: DropUpdate) => void, claimFiles: (names: string[]) => Promise<unknown>): DropController {
  let inside = false;
  let last: DropPoint | null = null;
  return {
    get inside() {
      return inside;
    },
    over(point, count) {
      if (!inside) {
        inside = true;
        last = point;
        return emit({ phase: "enter", x: point.x, y: point.y, count, items: [] });
      }
      if (last && last.x === point.x && last.y === point.y) return;
      last = point;
      emit({ phase: "move", x: point.x, y: point.y, count, items: [] });
    },
    leave() {
      if (!inside) return;
      inside = false;
      last = null;
      emit({ phase: "exit", x: 0, y: 0, count: 0, items: [] });
    },
    async drop(point, payload) {
      const entered = inside;
      inside = false;
      last = null;
      const items = domDropItems(payload);
      if (payload.fileNames.length) {
        const claimed = await claimFiles(payload.fileNames).catch(() => null);
        const files = Array.isArray(claimed) ? claimed.filter(validFileUrl) : [];
        items.unshift(...files.map((url) => ({ kind: "file" as const, url })));
      }
      if (!entered) emit({ phase: "enter", x: point.x, y: point.y, count: items.length, items: [] });
      emit({ phase: "drop", x: point.x, y: point.y, count: items.length, items });
    },
  };
}
