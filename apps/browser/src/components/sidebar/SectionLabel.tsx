import { Text } from "../ui";
import { font, lineHeight as lineHeights } from "../ui/tokens";

export function SectionLabel({
  title,
  inset,
  top = 0,
  bottom = 0,
  fontSize = font.caption.fontSize,
  lineHeight = lineHeights.caption,
}: {
  title: string;
  inset: number;
  top?: number;
  bottom?: number;
  fontSize?: number;
  lineHeight?: number;
}) {
  return (
    <Text lines={1} size="caption" weight="semibold" tone="textSecondary" style={{ fontSize, lineHeight, paddingHorizontal: inset, paddingTop: top, paddingBottom: bottom }}>
      {title}
    </Text>
  );
}
