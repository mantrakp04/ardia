import { createContext, forwardRef, useContext, type ComponentProps } from "react";
import { StyleSheet, Text as WebText, type TextStyle } from "react-native-web";

export const TEXT_METRICS = { lineHeightDelta: 0, bottomPad: 1, rightPad: 0.8 } as const;

const NORMAL_LINE_HEIGHT = 1.2;
const Nested = createContext(false);

type Props = ComponentProps<typeof WebText>;

export const MacText = forwardRef<unknown, Props>(function MacText({ style, children, ...props }, ref) {
  const nested = useContext(Nested);
  const Text = WebText as unknown as React.ComponentType<Record<string, unknown>>;
  if (nested) return <Text {...props} ref={ref} style={style}>{children}</Text>;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const size = typeof flat.fontSize === "number" ? flat.fontSize : 14;
  const metrics: TextStyle =
    flat.lineHeight == null
      ? {
          lineHeight: Math.round(size * NORMAL_LINE_HEIGHT) + TEXT_METRICS.lineHeightDelta,
          paddingBottom: (flat.paddingBottom as number | undefined) ?? TEXT_METRICS.bottomPad,
          paddingRight: (flat.paddingRight as number | undefined) ?? TEXT_METRICS.rightPad,
        }
      : {};
  return (
    <Nested.Provider value>
      <Text {...props} ref={ref} style={[style, metrics]}>
        {children}
      </Text>
    </Nested.Provider>
  );
});
