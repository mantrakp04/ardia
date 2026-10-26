import { Pressable, View } from "react-native";
import { radius, space, Text, useTheme } from "../ui";
import { pagesColors, toastInk, undoToast } from "./tokens";

export function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  const dark = useTheme().dark;
  return (
    <View pointerEvents="box-none" style={DOCK}>
      <View style={[PILL, { backgroundColor: (dark ? pagesColors.dark : pagesColors.light).toastFill }]}>
        <Text style={MESSAGE}>{message}</Text>
        <Pressable onPress={onUndo} style={ACTION}>
          <Text weight="semibold" style={ACTION_TEXT}>
            Undo
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const DOCK = { position: "absolute", left: 0, right: 0, bottom: undoToast.bottom, alignItems: "center" } as const;
const PILL = {
  flexDirection: "row",
  alignItems: "center",
  gap: space.lx,
  paddingLeft: undoToast.padLeft,
  paddingRight: undoToast.padRight,
  height: undoToast.height,
  borderRadius: radius.card,
} as const;
const MESSAGE = { color: toastInk.text } as const;
const ACTION = { paddingHorizontal: space.ml, height: undoToast.actionHeight, borderRadius: radius.m, justifyContent: "center" } as const;
const ACTION_TEXT = { color: toastInk.action } as const;
