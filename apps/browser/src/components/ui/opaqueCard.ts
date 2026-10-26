import { hex, type Theme } from "./theme";

const channels = (color: string) => {
  const digits = hex(color).replace("#", "");
  return [0, 2, 4, 6].map((i) => (i < digits.length ? parseInt(digits.slice(i, i + 2), 16) : 255));
};

export function opaqueCard(theme: Pick<Theme, "card" | "windowTint">): string {
  const [r, g, b, a] = channels(theme.card);
  const top = channels(theme.windowTint[0]);
  const bottom = channels(theme.windowTint[1]);
  const alpha = a! / 255;
  const under = (i: number) => (top[i]! + bottom[i]!) / 2;
  return `#${[r!, g!, b!].map((v, i) => Math.round(alpha * v + (1 - alpha) * under(i)).toString(16).padStart(2, "0")).join("")}`;
}
