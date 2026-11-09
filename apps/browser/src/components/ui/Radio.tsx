import { Symbol } from "@ardia/shell";
import { memo } from "react";
import { View } from "react-native";
import { Dot } from "./Dot";
import { useTheme } from "./theme";
import { capsule } from "./tokens";

const RING = { box: 16, on: 5, off: 1.5 } as const;
const COMPACT = { box: 14, glyph: 6, glyphBox: 8 } as const;
const FORM = { box: 16, dot: 6 } as const;

export const Radio = memo(function Radio({ on, look = "form" }: { on: boolean; look?: "form" | "compact" | "ring" }) {
  const theme = useTheme();
  if (look === "ring")
    return <View style={{ width: RING.box, height: RING.box, borderRadius: capsule(RING.box), borderWidth: on ? RING.on : RING.off, borderColor: on ? theme.ringRadioOn : theme.ringRadioBorder, backgroundColor: theme.ringRadioFill }} />;
  if (look === "compact")
    return (
      <View
        style={{
          width: COMPACT.box,
          height: COMPACT.box,
          borderRadius: capsule(COMPACT.box),
          borderWidth: on ? 0 : 1,
          borderColor: theme.fieldBorder,
          backgroundColor: on ? theme.formAccent : theme.control,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && <Symbol name="circle.fill" size={COMPACT.glyph} color={theme.onAccent} style={{ width: COMPACT.glyphBox, height: COMPACT.glyphBox }} />}
      </View>
    );
  return (
    <View
      style={{
        width: FORM.box,
        height: FORM.box,
        borderRadius: capsule(FORM.box),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? theme.formAccent : theme.control,
        borderWidth: on ? 0 : 1,
        borderColor: theme.controlBorder,
      }}
    >
      {on && <Dot size={FORM.dot} color={theme.onAccent} />}
    </View>
  );
});
