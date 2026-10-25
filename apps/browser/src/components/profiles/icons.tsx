import { Text, View } from "react-native";
import { profileAccent } from "../../lib/theme";
import type { Profile } from "../../store/types";
import { classifyIcon, profileInitial } from "../icons/classify";
import { IconGlyph } from "../icons/IconGlyph";

export { PROFILE_SYMBOLS } from "../icons/iconSets";
export { profileInitial, profileSymbol } from "../icons/classify";

export function ProfileBadge({ profile, size = 26 }: { profile: Pick<Profile, "name" | "color" | "icon"> & Partial<Pick<Profile, "theme">>; size?: number }) {
  const swatch = profileAccent(profile);
  const classified = classifyIcon(profile.icon);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: swatch,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: size >= 22 ? 0.5 : 0,
        borderColor: "rgba(0,0,0,0.12)",
      }}
    >
      {classified.kind === "initial" ? (
        <Text style={{ fontSize: size * 0.46, fontWeight: "600", color: "#FFFFFF" }}>{profileInitial(profile.name)}</Text>
      ) : (
        <IconGlyph icon={profile.icon} size={size * 0.62} color="#FFFFFF" weight="semibold" />
      )}
    </View>
  );
}
