import type { BarSize } from "./tokens";

export function chipFrame(size: BarSize, { titled, width }: { titled: boolean; width?: number }) {
  return { width, minWidth: undefined as number | undefined, paddingHorizontal: titled ? size.padding : 0 };
}
