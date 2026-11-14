import { Appearance } from "react-native";

export const applyAppearance = (mode: "system" | "light" | "dark") => Appearance.setColorScheme(mode === "system" ? null : mode);
