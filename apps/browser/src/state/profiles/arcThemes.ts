import { showMenu, type MenuItem } from "../../platform/menus";
import { themeAccent } from "../../lib/profileLook";
import type { ProfileTheme } from "../browser/types";
import { parseArcTheme } from "../import/arcTheme";
import { setProfileTheme } from "./themeActions";
import { importModule } from "../../platform/importModule";

export async function arcThemeChoices(): Promise<{ id: string; name: string; emoji?: string; color?: string; theme: ProfileTheme }[]> {
  const api = importModule();
  if (!api) return [];
  const browsers = await api.listBrowsers().catch(() => []);
  const arc = browsers.find((b) => b.id === "arc");
  return (arc?.profiles ?? []).flatMap((p) =>
    (p.spaces ?? []).flatMap((s) => {
      const theme = s.theme ? parseArcTheme(s.theme) : null;
      return theme ? [{ id: s.id, name: s.name, emoji: s.emoji, color: s.color, theme }] : [];
    }),
  );
}

export async function importArcTheme(profileId: string): Promise<boolean> {
  const choices = await arcThemeChoices();
  const items: MenuItem[] = choices.length
    ? choices.map((c) => ({ id: c.id, title: c.emoji ? `${c.emoji}  ${c.name}` : c.name, swatch: themeAccent(c.theme) }))
    : [{ id: "none", title: "No Arc spaces with a theme found", enabled: false }];
  const choice = await showMenu(items);
  const picked = choices.find((c) => c.id === choice);
  if (!picked) return false;
  setProfileTheme(profileId, picked.theme);
  return true;
}
