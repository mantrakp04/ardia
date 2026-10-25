import { Surface } from "@ardia/shell";
import { Pressable } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { ICON_PICKER_WIDTH, IconPickerPanel } from "../icons/IconPickerPanel";
import { setIcon } from "./actions";
import { setSidebarUi, useSidebarUi } from "./state";

export function IconPicker({ windowId, sidebarWidth }: { windowId: string; sidebarWidth: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

const PANEL_PADDING = 8;

function PickerPanel({ picker, sidebarWidth }: { picker: Picker; sidebarWidth: number }) {
  const theme = useTheme();
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useBrowser((s) => (picker.kind === "tab" ? s.tabs[picker.id]?.customIcon : picker.kind === "live" ? liveIcon : s.groups[picker.id]?.icon) ?? null);
  const close = () => setSidebarUi({ iconPicker: null });
  const top = Math.max(8, (picker.anchor?.y ?? 60) - 8);
  const left = picker.anchor ? Math.max(8, Math.min(sidebarWidth + 6, picker.anchor.x + picker.anchor.width + 6)) : sidebarWidth + 6;

  return (
    <>
      <Pressable onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={20}
        shadowOffset={[0, 8]}
        style={{ position: "absolute", top, left, width: ICON_PICKER_WIDTH + PANEL_PADDING * 2, padding: PANEL_PADDING }}
      >
        <IconPickerPanel
          current={current}
          kind={picker.kind === "folder" ? "group" : picker.kind}
          onPick={(icon) => {
            setIcon(picker, icon);
            close();
          }}
          onClose={close}
        />
      </Surface>
    </>
  );
}
