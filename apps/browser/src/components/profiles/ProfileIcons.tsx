import { Text } from "react-native";
import { Dot, hairline, ink, Symbol, weight } from "../ui";
import { profileAccent } from "../ui/theme";
import type { Profile } from "../../state/browser/types";
import { profileColors, profileSwitcher } from "./tokens";
import { iconSymbol } from "../../lib/customIcon";

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
  { name: "person.fill", title: "Me" },
  { name: "person.2.fill", title: "Family" },
  { name: "building.2.fill", title: "Office" },
  { name: "terminal.fill", title: "Terminal" },
  { name: "server.rack", title: "Servers" },
  { name: "flask.fill", title: "Lab" },
  { name: "lightbulb.fill", title: "Ideas" },
  { name: "sparkles", title: "Side Projects" },
  { name: "newspaper.fill", title: "News" },
  { name: "film.fill", title: "Movies" },
  { name: "headphones", title: "Podcasts" },
  { name: "sportscourt.fill", title: "Sports" },
  { name: "bicycle", title: "Cycling" },
  { name: "fork.knife", title: "Food" },
  { name: "gift.fill", title: "Gifts" },
  { name: "stethoscope", title: "Health" },
  { name: "chart.line.uptrend.xyaxis", title: "Stocks" },
  { name: "envelope.fill", title: "Mail" },
  { name: "bubble.left.and.bubble.right.fill", title: "Chat" },
  { name: "calendar", title: "Calendar" },
  { name: "mountain.2.fill", title: "Outdoors" },
  { name: "beach.umbrella.fill", title: "Holiday" },
  { name: "lock.fill", title: "Private" },
  { name: "flame.fill", title: "Hot" },
  { name: "bolt.fill", title: "Energy" },
];

export const switcherCellWidth = (icon: string | null) => (icon ? profileSwitcher.iconCell : profileSwitcher.dotCell);

export function switcherIcons(icons: (string | null)[], shown: boolean, room: number): (string | null)[] {
  const fits = icons.reduce((width, icon) => width + switcherCellWidth(icon), 0) <= room;
  return shown && fits ? icons : icons.map(() => null);
}

export function SwitcherMark({ icon, color, scale = 1 }: { icon: string | null; color: string; scale?: number }) {
  const { iconCell, icon: size, dot } = profileSwitcher;
  const symbol = iconSymbol(icon);
  if (symbol) return <Symbol name={symbol} size={size * scale} weight="semibold" color={color} style={{ width: iconCell * scale, height: iconCell * scale }} />;
  if (icon)
    return (
      <Text numberOfLines={1} style={{ width: iconCell * scale, fontSize: size * scale, lineHeight: iconCell * scale, textAlign: "center", color }}>
        {icon}
      </Text>
    );
  return <Dot size={dot * scale} color={color} />;
}

const BADGE_EDGE_MIN = 22;

export function ProfileBadge({ profile, size = 26 }: { profile: Pick<Profile, "name" | "color" | "icon"> & Partial<Pick<Profile, "theme">>; size?: number }) {
  const swatch = profileAccent(profile);
  const symbol = iconSymbol(profile.icon);
  return (
    <Dot size={size} color={swatch} ring={size >= BADGE_EDGE_MIN ? profileColors.badgeEdge : undefined} ringWidth={hairline.ring}>
      {symbol ? (
        <Symbol name={symbol} size={size * 0.5} weight="semibold" color={ink.white} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ fontSize: profile.icon ? size * 0.55 : size * 0.46, fontWeight: weight.semibold, color: ink.white }}>
          {profile.icon ?? (profile.name.trim()[0] ?? "?").toUpperCase()}
        </Text>
      )}
    </Dot>
  );
}
