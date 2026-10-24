const UNIT = String.raw`(?:(?![\u{1F1E6}-\u{1F1FF}])(?!\p{Emoji_Modifier})\p{Emoji_Presentation}\p{Emoji_Modifier}?|\p{Extended_Pictographic}️)`;
const SINGLE_EMOJI = new RegExp(
  String.raw`^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|${UNIT}(?:‍${UNIT})*)$`,
  "u",
);

export function isEmojiIcon(value: string | null): value is string {
  return !!value && value.length <= 32 && SINGLE_EMOJI.test(value);
}
