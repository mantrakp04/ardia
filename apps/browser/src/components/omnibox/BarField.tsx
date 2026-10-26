import type { SearchScope } from "@ardia/core";
import type { ComponentProps, RefObject } from "react";
import { TextInput } from "react-native";
import { useTheme } from "../ui";
import { PASTED_TYPES } from "./omniboxKeys";
import { BAR, BAR_TYPE } from "./tokens";

type InputProps = ComponentProps<typeof TextInput>;

export function BarField({
  inputRef,
  variant,
  floating,
  scope,
  incognito,
  focusEcho,
  onSelection,
  ...events
}: {
  inputRef: RefObject<TextInput | null>;
  focusEcho: RefObject<boolean>;
  onSelection(next: { start: number; end: number }): void;
  variant: "panel" | "hero" | "sidebar";
  floating: boolean;
  scope: SearchScope | null;
  incognito: boolean;
} & Pick<InputProps, "value" | "onLayout" | "onChangeText" | "onSubmitEditing" | "onFocus" | "onBlur" | "keyDownEvents" | "onKeyDown">) {
  const theme = useTheme();
  const type = variant === "hero" ? BAR_TYPE.heroField : variant === "sidebar" || floating ? BAR_TYPE.floatingField : BAR_TYPE.panelField;
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
        ...type,
        color: theme.textPrimary,
        paddingVertical: 0,
        marginTop: variant === "panel" ? BAR.panelFieldLift : 0,
      }}
    />
  );
}
