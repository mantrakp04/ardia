import { Symbol } from "@ardia/shell";
import { memo } from "react";
import { View } from "react-native";
import { useTheme } from "./theme";

export const Radio = memo(function Radio({ on, look = "form" }: { on: boolean; look?: "form" | "compact" | "ring" }) {
  const theme = useTheme();
  if (look === "ring")
    return <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: on ? 5 : 1.5, borderColor: on ? theme.ringRadioOn : theme.ringRadioBorder, backgroundColor: theme.ringRadioFill }} />;
  if (look === "compact")
    return (
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          borderWidth: on ? 0 : 1,
          borderColor: theme.fieldBorder,
          backgroundColor: on ? theme.formAccent : theme.control,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && <Symbol name="circle.fill" size={6} color={theme.onAccent} style={{ width: 8, height: 8 }} />}
      </View>
    );
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? theme.formAccent : theme.control,
        borderWidth: on ? 0 : 1,
        borderColor: theme.controlBorder,
      }}
    >
      {on && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.onAccent }} />}
    </View>
  );
});
