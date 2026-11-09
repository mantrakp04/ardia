import { View } from "react-native";
import type { AnonymousAvatar as Avatar } from "../../state/telemetry/identity";
import { capsule, ThemeSwatch } from "../ui";

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;

export function avatarColors(avatar: Avatar): number[] {
  return avatar.colors.flatMap((hex) => [channel(hex, 1), channel(hex, 3), channel(hex, 5), 1]);
}

export function AnonymousAvatar({ avatar, size }: { avatar: Avatar; size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: capsule(size), overflow: "hidden" }}>
      <ThemeSwatch colors={avatarColors(avatar)} angle={avatar.angle} style={{ flex: 1 }} />
    </View>
  );
}
