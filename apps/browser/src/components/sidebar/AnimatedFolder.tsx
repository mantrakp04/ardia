import { FolderIcon } from "@ardia/shell";
import { memo } from "react";
import { useTheme } from "../../lib/theme";
import type { GroupColor } from "../../store/types";
import { hasOwnGroupIcon, TabIcon } from "./TabIcon";
import { GROUP_COLORS } from "./tokens";

const FOLDER_ACCENT = "#443AFF";

function channels(color: string): [number, number, number] {
  const n = parseInt(color.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(color: string, base: string, amount: number): string {
  const a = channels(color);
  const b = channels(base);
  return `#${a.map((v, i) => Math.round(v * amount + b[i]! * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

function folderPalette(color: string, dark: boolean) {
  return dark
    ? { stroke: mix(color, "#FFFFFF", 0.64), face: mix(color, "#211E29", 0.12), insideTop: mix(color, "#211E29", 0.4), insideBottom: mix(color, "#15121E", 0.24) }
    : { stroke: color, face: mix(color, "#FFFFFF", 0.06), insideTop: mix(color, "#FFFFFF", 0.34), insideBottom: mix(color, "#FFFFFF", 0.64) };
}

export const AnimatedFolder = memo(function AnimatedFolder({ open, color, size = 16 }: { open: boolean; color?: GroupColor | null; size?: number }) {
  const theme = useTheme();
  const palette = folderPalette((color && GROUP_COLORS[color]?.hex) || FOLDER_ACCENT, theme.dark);
  return <FolderIcon open={open} {...palette} style={{ width: size, height: size }} />;
});

export function FolderOrIcon({ icon, open, color }: { icon: string | null | undefined; open: boolean; color?: GroupColor | null }) {
  return hasOwnGroupIcon(icon) ? <TabIcon url="" icon={icon} /> : <AnimatedFolder open={open} color={color} />;
}
