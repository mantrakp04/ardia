export const SYMBOL_PREFIX = "symbol:";

export const NO_GROUP_ICON = `${SYMBOL_PREFIX}square.stack.fill`;
export const NO_GROUP_ICON_INK = { light: "#00000040", dark: "#FFFFFF40" };

export const hasOwnGroupIcon = (icon: string | null | undefined): icon is string => !!icon && icon !== NO_GROUP_ICON;

export type ClassifiedIcon =
  | { kind: "symbol"; name: string }
  | { kind: "emoji"; text: string }
  | { kind: "glyph"; text: string }
  | { kind: "initial" }
  | { kind: "text"; text: string };

const EMOJI_UNIT = String.raw`(?:(?![\u{1F1E6}-\u{1F1FF}])(?!\p{Emoji_Modifier})\p{Emoji_Presentation}\p{Emoji_Modifier}?|\p{Extended_Pictographic}️)`;
const SINGLE_EMOJI = new RegExp(
  String.raw`^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|${EMOJI_UNIT}(?:‍${EMOJI_UNIT})*)$`,
  "u",
);

const SINGLE_GLYPH = /^[^\p{Cc}\p{Cs}\p{Cf}\p{Z}\p{M}\p{Emoji_Modifier}\p{Regional_Indicator}]\p{M}*$/u;
const JOINER = "\u200D";

export function isSingleEmoji(value: string | null | undefined): value is string {
  return !!value && value.length <= 32 && SINGLE_EMOJI.test(value);
}

export function isSingleGlyph(value: string | null | undefined): value is string {
  return !!value && value.length <= 8 && !value.includes(JOINER) && !isSingleEmoji(value) && SINGLE_GLYPH.test(value);
}

export function classifyIcon(icon: string | null | undefined): ClassifiedIcon {
  if (!icon) return { kind: "initial" };
  if (icon.startsWith(SYMBOL_PREFIX)) {
    const name = icon.slice(SYMBOL_PREFIX.length);
    return name ? { kind: "symbol", name } : { kind: "initial" };
  }
  if (isSingleEmoji(icon)) return { kind: "emoji", text: icon };
  if (isSingleGlyph(icon)) return { kind: "glyph", text: icon };
  return { kind: "text", text: icon };
}

export const profileSymbol = (icon: string | null | undefined) => {
  const classified = classifyIcon(icon);
  return classified.kind === "symbol" ? classified.name : null;
};

export const profileInitial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
