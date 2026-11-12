import type { SearchScope } from "@ardia/core";
import type { ComponentProps, RefObject } from "react";
import { TextInput, type TextStyle } from "react-native";
import { useTheme } from "../ui";
import { PASTED_TYPES } from "./omniboxKeys";
import { BAR } from "./tokens";

type InputProps = ComponentProps<typeof TextInput>;

export function BarField({
  inputRef,
  variant,
  scope,
  incognito,
  textStyle,
  focusEcho,
  onSelection,
  ...events
}: {
  inputRef: RefObject<TextInput | null>;
  focusEcho: RefObject<boolean>;
  onSelection(next: { start: number; end: number }): void;
  variant: "panel" | "hero" | "sidebar";
  scope: SearchScope | null;
  incognito: boolean;
  textStyle: TextStyle;
} & Pick<InputProps, "value" | "onLayout" | "onChangeText" | "onSubmitEditing" | "onFocus" | "onBlur" | "keyDownEvents" | "onKeyDown">) {
  const theme = useTheme();
  return (
    <TextInput
      ref={inputRef}
      {...events}
      onSelectionChange={(e) => {
        const next = e.nativeEvent.selection;
        const length = events.value?.length ?? 0;
        if (focusEcho.current) {
          const atEnd = next.start === length && next.end === length;
          if (atEnd || (next.start === 0 && next.end === length)) {
            if (atEnd) focusEcho.current = false;
            return;
          }
          focusEcho.current = false;
        }
        onSelection(next);
      }}
      placeholder={scope ? `Search ${scope.name}` : incognito ? "Search privately or enter address" : "Search or enter address"}
      placeholderTextColor={theme.placeholder}
      pastedTypes={PASTED_TYPES}
      selectionColor={theme.selection}
      enableFocusRing={false}
      style={{
        flex: 1,
        ...textStyle,
        color: theme.textPrimary,
        paddingVertical: 0,
        marginTop: variant === "panel" ? BAR.panelFieldLift : 0,
      }}
    />
  );
}
