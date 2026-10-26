import type { LookSource, ProfileLookFields, ThemeBackdropProps } from "../../lib/profileLook";
import type { BackdropTint } from "../../lib/windowTint";

export type ProfileLookColors = { windowTint: [string, string]; backdrop: BackdropTint & ThemeBackdropProps; grain: number };

type ProfileLooks = {
  accent(profile: ProfileLookFields | undefined): string;
  theme(profile: ProfileLookFields | undefined, appDark: boolean, source: LookSource): ProfileLookColors;
};

let looks: ProfileLooks | null = null;

export function provideProfileLooks(resolver: ProfileLooks) {
  looks = resolver;
}

export const profileAccentOf = (profile: ProfileLookFields | undefined): string | undefined => looks?.accent(profile);

export const profileColorsOf = (profile: ProfileLookFields | undefined, appDark: boolean, source: LookSource): ProfileLookColors | null =>
  looks?.theme(profile, appDark, source) ?? null;
