import { useTheme } from "../ui";
import { settingsColors } from "./tokens";

export function useSettingsColors() {
  return settingsColors[useTheme().dark ? "dark" : "light"];
}
