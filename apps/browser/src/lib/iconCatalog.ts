export const SYMBOL_PREFIX = "symbol:";

export type IconStyle = "symbols" | "lucide" | "duotone";

export const ICON_STYLES = [
  { id: "symbols", label: "Native" },
  { id: "lucide", label: "Lucide" },
  { id: "duotone", label: "Duotone" },
] as const;

export const ATLAS_COLUMNS = 10;
export const ATLAS_ROWS = 8;

export const ICON_CATALOG = [
  { name: "star", label: "Star", keywords: "favorite" },
  { name: "heart", label: "Heart", keywords: "love" },
  { name: "bookmark", label: "Bookmark", keywords: "saved" },
  { name: "flag", label: "Flag", keywords: "" },
  { name: "pin", label: "Pin", keywords: "" },
  { name: "bolt", label: "Lightning", keywords: "fast bolt" },
  { name: "flame", label: "Flame", keywords: "fire hot" },
  { name: "leaf", label: "Leaf", keywords: "nature plant" },
  { name: "globe", label: "Globe", keywords: "world earth" },
  { name: "house", label: "Home", keywords: "house" },
  { name: "briefcase", label: "Briefcase", keywords: "work" },
  { name: "cart", label: "Shopping cart", keywords: "" },
  { name: "bag", label: "Shopping bag", keywords: "" },
  { name: "creditcard", label: "Credit card", keywords: "payment" },
  { name: "dollarsign.circle", label: "Money", keywords: "dollar finance" },
  { name: "chart.bar", label: "Bar chart", keywords: "data" },
  { name: "chart.line.uptrend.xyaxis", label: "Growth chart", keywords: "stocks trend finance" },
  { name: "calendar", label: "Calendar", keywords: "date" },
  { name: "clock", label: "Clock", keywords: "time" },
  { name: "alarm", label: "Alarm", keywords: "" },
  { name: "envelope", label: "Mail", keywords: "email envelope" },
  { name: "bubble.left", label: "Chat", keywords: "message conversation" },
  { name: "phone", label: "Phone", keywords: "call" },
  { name: "video", label: "Video", keywords: "" },
  { name: "music.note", label: "Music", keywords: "song" },
  { name: "headphones", label: "Headphones", keywords: "music audio" },
  { name: "gamecontroller", label: "Games", keywords: "play controller" },
  { name: "paintbrush", label: "Paintbrush", keywords: "art design" },
  { name: "camera", label: "Camera", keywords: "photo" },
  { name: "film", label: "Film", keywords: "movie" },
  { name: "tv", label: "TV", keywords: "television watch" },
  { name: "airplane", label: "Airplane", keywords: "travel flight" },
  { name: "map", label: "Map", keywords: "travel" },
  { name: "car", label: "Car", keywords: "drive" },
  { name: "fork.knife", label: "Food", keywords: "restaurant dining" },
  { name: "cup.and.saucer", label: "Coffee", keywords: "cup tea" },
  { name: "figure.run", label: "Running", keywords: "fitness gym exercise" },
  { name: "sportscourt", label: "Sports", keywords: "court" },
  { name: "pawprint", label: "Pets", keywords: "animal paw" },
  { name: "tree", label: "Tree", keywords: "nature" },
  { name: "sun.max", label: "Sun", keywords: "day weather" },
  { name: "moon", label: "Moon", keywords: "night" },
  { name: "cloud", label: "Cloud", keywords: "weather" },
  { name: "snowflake", label: "Snowflake", keywords: "snow cold" },
  { name: "sparkles", label: "Sparkles", keywords: "" },
  { name: "gift", label: "Gift", keywords: "present" },
  { name: "trophy", label: "Trophy", keywords: "win award" },
  { name: "target", label: "Target", keywords: "goal" },
  { name: "brain", label: "Brain", keywords: "think" },
  { name: "eye", label: "Eye", keywords: "look" },
  { name: "laptopcomputer", label: "Laptop", keywords: "computer code" },
  { name: "desktopcomputer", label: "Desktop", keywords: "computer monitor" },
  { name: "keyboard", label: "Keyboard", keywords: "type" },
  { name: "hammer", label: "Hammer", keywords: "tools build" },
  { name: "wrench.and.screwdriver", label: "Tools", keywords: "fix repair" },
  { name: "gearshape", label: "Settings", keywords: "gear" },
  { name: "testtube.2", label: "Science", keywords: "test lab research" },
  { name: "ant", label: "Bug", keywords: "ant insect" },
  { name: "lock", label: "Lock", keywords: "secure privacy" },
  { name: "key", label: "Key", keywords: "" },
  { name: "puzzlepiece", label: "Puzzle", keywords: "extension" },
  { name: "shippingbox", label: "Package", keywords: "box shipping" },
  { name: "folder", label: "Folder", keywords: "files" },
  { name: "archivebox", label: "Archive", keywords: "storage" },
  { name: "newspaper", label: "News", keywords: "paper" },
  { name: "link", label: "Link", keywords: "" },
  { name: "magnifyingglass", label: "Search", keywords: "find" },
  { name: "safari", label: "Compass", keywords: "explore browser" },
  { name: "tag", label: "Tag", keywords: "label" },
  { name: "lightbulb", label: "Idea", keywords: "light bulb" },
  { name: "questionmark.circle", label: "Question", keywords: "help" },
  { name: "exclamationmark.triangle", label: "Warning", keywords: "important" },
  { name: "book", label: "Book", keywords: "read study" },
  { name: "graduationcap", label: "Education", keywords: "school study graduate" },
  { name: "doc.text", label: "Document", keywords: "note write" },
  { name: "list.bullet", label: "List", keywords: "tasks" },
  { name: "checkmark.circle", label: "Checkmark", keywords: "done complete" },
  { name: "person.2", label: "People", keywords: "team group" },

] as const;

const ICON_INDEX = new Map<string, number>(ICON_CATALOG.map(({ name }, index) => [name, index]));
const PREFIXES: Record<IconStyle, string> = { symbols: SYMBOL_PREFIX, lucide: "lucide:", duotone: "duotone:" };

export function isVectorIcon(value: string | null | undefined): boolean {
  return !!value && ICON_STYLES.some(({ id }) => value.startsWith(PREFIXES[id]));
}

export function iconIndex(name: string): number {
  return ICON_INDEX.get(name) ?? -1;
}

export function normalizeIconColor(value: string | null | undefined): string | null {
  if (!value || !/^#?[0-9a-f]{6}$/i.test(value)) return null;
  return `#${value.replace(/^#/, "").toUpperCase()}`;
}

export function iconValue(style: IconStyle, name: string, color?: string | null): string {
  const normalized = normalizeIconColor(color);
  return PREFIXES[style] + name + (normalized ? `|${normalized}` : "");
}

export function parseCustomIcon(value: string | null | undefined): { style: IconStyle; name: string; color?: string } | null {
  if (!value) return null;
  for (const { id } of ICON_STYLES) {
    const prefix = PREFIXES[id];
    if (!value.startsWith(prefix)) continue;
    const parts = value.slice(prefix.length).split("|");
    const name = parts[0];
    if (!name || parts.length > 2 || (id !== "symbols" && !ICON_INDEX.has(name))) return null;
    if (parts.length === 1) return { style: id, name };
    const rawColor = parts[1];
    if (!rawColor || !/^#[0-9a-f]{6}$/i.test(rawColor)) return null;
    const color = normalizeIconColor(rawColor);
    return color ? { style: id, name, color } : null;
  }
  return null;
}
