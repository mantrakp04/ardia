import { FolderIcon } from "@ardia/shell";
import { memo } from "react";
import { mix, useTheme } from "../../lib/theme";
import type { GroupColor } from "../../store/types";
import { hasOwnGroupIcon, TabIcon } from "./TabIcon";
import { GROUP_COLORS } from "./tokens";

const FOLDER_ACCENT = "#443AFF";

function folderPalette(color: string, dark: boolean) {
  return dark
    ? { stroke: mix("#FFFFFF", color, 0.64), face: mix("#211E29", color, 0.12), insideTop: mix("#211E29", color, 0.4), insideBottom: mix("#15121E", color, 0.24) }
    : { stroke: color, face: mix("#FFFFFF", color, 0.06), insideTop: mix("#FFFFFF", color, 0.34), insideBottom: mix("#FFFFFF", color, 0.64) };
}

export const AnimatedFolder = memo(function AnimatedFolder({ open, color, size = 16 }: { open: boolean; color?: GroupColor | null; size?: number }) {
  const theme = useTheme();
  const palette = folderPalette((color && GROUP_COLORS[color]?.hex) || FOLDER_ACCENT, theme.dark);
  return <FolderIcon open={open} {...palette} style={{ width: size, height: size }} />;
});

export function FolderOrIcon({ icon, open, color }: { icon: string | null | undefined; open: boolean; color?: GroupColor | null }) {
  return hasOwnGroupIcon(icon) ? <TabIcon url="" icon={icon} /> : <AnimatedFolder open={open} color={color} />;
}
