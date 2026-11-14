import type { BarSize } from "./tokens";

export function chipFrame(size: BarSize, { titled, width }: { titled: boolean; width?: number }) {
  return {
    width,
    minWidth: titled || width !== undefined ? undefined : size.item,
    paddingHorizontal: titled ? size.padding : 0,
  };
}
