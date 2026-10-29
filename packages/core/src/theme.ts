export const THEME_TEXTURES = ["grain", "sand", "denim", "tweed"] as const;

export type ThemeTexture = (typeof THEME_TEXTURES)[number];

export type ThemeMode = "auto" | "light" | "dark";

export type ThemeBackdropProps = {
  themeColors: number[];
  themeOpacity: number;
  themeBaseAlpha: number;
  themeGrain: number;
  themeTexture: ThemeTexture;
  themeAppearance: ThemeMode;
  themeAngle: number;
};
