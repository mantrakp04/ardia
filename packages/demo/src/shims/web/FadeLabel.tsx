import { useLayoutEffect, useRef, useState } from "react";
import { View, type ViewProps } from "react-native";

const CELL_PADDING = 2;

const WEIGHTS = { light: "300", regular: "400", medium: "500", semibold: "600", bold: "700" } as const;

export type FadeLabelProps = ViewProps & { text: string; fontSize?: number; weight?: keyof typeof WEIGHTS; color?: string; fadeWidth?: number };

export function FadeLabel({ text, fontSize = 13, weight = "regular", color, fadeWidth = 24, style, ...props }: FadeLabelProps) {
  const field = useRef<HTMLDivElement | null>(null);
  const run = useRef<HTMLSpanElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const node = field.current;
    const textRun = run.current;
    if (!node || !textRun) return;
    const measure = () => {
      const bounds = node.getBoundingClientRect().width;
      setOverflows(bounds > 0 && textRun.getBoundingClientRect().width + 2 * CELL_PADDING > bounds + 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, fontSize, weight]);

  const fade = overflows ? `linear-gradient(to right, #000 0, #000 calc(100% - ${fadeWidth}px), transparent 100%)` : undefined;
  return (
    <View {...props} pointerEvents="none" style={[{ justifyContent: "center", overflow: "hidden" }, style]}>
      <div
        ref={field}
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "clip",
          paddingLeft: CELL_PADDING,
          fontSize,
          fontWeight: WEIGHTS[weight],
          fontVariantNumeric: "tabular-nums",
          color: color ?? "currentColor",
          lineHeight: "normal",
          maskImage: fade,
          WebkitMaskImage: fade,
          userSelect: "none",
          cursor: "inherit",
        }}
      >
        <span ref={run}>{text}</span>
      </div>
    </View>
  );
}
