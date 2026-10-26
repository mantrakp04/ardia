import type { MenuItem } from "../../state/app/system";
import { Text, View } from "react-native";
import { ink, Symbol, weight } from "../ui";
import { profileAccent } from "../ui/theme";
import type { Profile } from "../../state/browser/types";
import { profileColors } from "./tokens";

export const PROFILE_SYMBOLS: { name: string; title: string }[] = [
  { name: "house.fill", title: "Home" },
  { name: "briefcase.fill", title: "Work" },
  { name: "graduationcap.fill", title: "School" },
  { name: "chevron.left.forwardslash.chevron.right", title: "Code" },
  { name: "paintpalette.fill", title: "Art" },
  { name: "hammer.fill", title: "Projects" },
  { name: "book.closed.fill", title: "Reading" },
  { name: "music.note", title: "Music" },
  { name: "camera.fill", title: "Photos" },
  { name: "gamecontroller.fill", title: "Games" },
  { name: "cart.fill", title: "Shopping" },
  { name: "banknote.fill", title: "Finance" },
  { name: "airplane", title: "Travel" },
  { name: "figure.run", title: "Fitness" },
  { name: "cup.and.saucer.fill", title: "Café" },
  { name: "leaf.fill", title: "Nature" },
  { name: "pawprint.fill", title: "Pets" },
  { name: "heart.fill", title: "Personal" },
  { name: "star.fill", title: "Favorites" },
  { name: "moon.stars.fill", title: "Evenings" },
];

const EMOJI = ["😀", "😎", "🤓", "🧑‍💻", "💼", "🏠", "🎓", "🎨", "🎮", "🎵", "📚", "✈️", "🌱", "🔥", "⭐️", "🚀", "🐶", "🐱", "🦊", "🍀"];

const SYMBOL_PREFIX = "symbol:";
export const profileSymbol = (icon: string | null) => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);

export function iconMenuItems(current: string | null): MenuItem[] {
  return [
    { id: "icon:", title: "Initial", checked: !current },
    { separator: true },
    ...PROFILE_SYMBOLS.map((s) => ({ id: `icon:${SYMBOL_PREFIX}${s.name}`, title: s.title, symbol: s.name, checked: current === SYMBOL_PREFIX + s.name })),
    { separator: true },
    {
      id: "emoji",
      title: "Emoji",
      checked: !!current && !profileSymbol(current),
      children: EMOJI.map((e) => ({ id: `icon:${e}`, title: e, checked: current === e })),
    },
  ];
}

export function ProfileBadge({ profile, size = 26 }: { profile: Pick<Profile, "name" | "color" | "icon"> & Partial<Pick<Profile, "theme">>; size?: number }) {
  const swatch = profileAccent(profile);
  const symbol = profileSymbol(profile.icon);
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
        borderColor: profileColors.badgeEdge,
      }}
    >
      {symbol ? (
        <Symbol name={symbol} size={size * 0.5} weight="semibold" color={ink.white} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontSize: profile.icon ? size * 0.55 : size * 0.46, fontWeight: weight.semibold, color: ink.white }}>
          {profile.icon ?? (profile.name.trim()[0] ?? "?").toUpperCase()}
        </Text>
      )}
    </View>
  );
}
