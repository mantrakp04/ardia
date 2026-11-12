import { hex, type Theme } from "./theme";
import { parseColor, toHex } from "../../lib/color";

export function opaqueCard(theme: Pick<Theme, "card" | "windowTint">): string {
  const [r, g, b, a] = parseColor(hex(theme.card));
  const top = parseColor(theme.windowTint[0]);
  const bottom = parseColor(theme.windowTint[1]);
  return toHex([r, g, b].map((v, i) => a * v + (1 - a) * ((top[i]! + bottom[i]!) / 2)));
}
