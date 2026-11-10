import { profileSwitcher } from "./tokens";

export type SwitcherLayout = { marks: (string | null)[]; cell: number; icons: boolean; mixed: boolean };

export function switcherLayout(icons: readonly (string | null)[], shown: boolean, room: number): SwitcherLayout {
  const withIcons = shown && icons.some(Boolean) && icons.length * profileSwitcher.iconCell <= room;
  if (!withIcons) return { marks: icons.map(() => null), cell: profileSwitcher.dotCell, icons: false, mixed: false };
  return { marks: [...icons], cell: profileSwitcher.iconCell, icons: true, mixed: icons.some((icon) => !icon) };
}
