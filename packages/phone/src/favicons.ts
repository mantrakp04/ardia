import { requireOptionalNativeModule } from "expo-modules-core";

export type FaviconTone = "opaque" | "darkOnClear" | "lightOnClear" | "mixed" | "blank";

export type FaviconLook = { tone: FaviconTone; backing: "light" | "dark" | null };

type FaviconNative = { look(url: string, dark: boolean): Promise<FaviconLook | null> };

const native = requireOptionalNativeModule<FaviconNative>("ArdiaPhoneFavicons");

export const favicons = {
  look: async (url: string, dark: boolean): Promise<FaviconLook | null> => (native ? native.look(url, dark) : null),
};
