import { profileSwitcher } from "./tokens";

export type SwitcherLayout = { marks: (string | null)[]; cell: number; icons: boolean; mixed: boolean };

const { iconCell, dotCell } = profileSwitcher;

export function switcherLayout(icons: readonly (string | null)[], shown: boolean, room: number): SwitcherLayout {
  const natural = icons.reduce((width, icon) => width + (icon ? iconCell : dotCell), 0);
  const withIcons = shown && icons.some(Boolean) && natural <= room;
  if (!withIcons) return { marks: icons.map(() => null), cell: dotCell, icons: false, mixed: false };
  return { marks: [...icons], cell: Math.min(iconCell, Math.floor(room / icons.length)), icons: true, mixed: icons.some((icon) => !icon) };
}
