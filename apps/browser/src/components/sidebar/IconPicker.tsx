import { useLive } from "../../state/live/store";
import { setIcon } from "../../state/sidebar/actions";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { useIconPickerCurrent } from "../../state/sidebar/hooks";
import { NO_GROUP_ICON } from "../../state/groups/groupIcons";
import { clampLeft, clampTop, IconPickerLayer, type PickerAction, type PickerSymbol } from "../iconPicker/IconPickerPanel";
import { ICON_PICKER, ICON_PICKER_WIDTH } from "../iconPicker/tokens";
import { useSidebarSide } from "../../state/browser/hooks";
import type { SidebarSide } from "../../state/browser/model";

const SYMBOLS: PickerSymbol[] = [
  "star", "heart", "bookmark", "flag", "pin", "bolt", "flame", "leaf", "globe", "house", "briefcase", "cart", "bag", "creditcard",
  "dollarsign.circle", "chart.bar", "chart.line.uptrend.xyaxis", "calendar", "clock", "alarm", "envelope", "bubble.left", "phone", "video",
  "music.note", "headphones", "gamecontroller", "paintbrush", "camera", "film", "tv", "airplane", "map", "car", "fork.knife", "cup.and.saucer",
  "figure.run", "sportscourt", "pawprint", "tree", "sun.max", "moon", "cloud", "snowflake", "sparkles", "gift", "trophy", "target", "brain",
  "eye", "laptopcomputer", "desktopcomputer", "keyboard", "hammer", "wrench.and.screwdriver", "gearshape", "testtube.2", "ant", "lock",
  "key", "puzzlepiece", "shippingbox", "folder", "archivebox", "newspaper", "link", "magnifyingglass", "safari", "tag", "lightbulb",
  "questionmark.circle", "exclamationmark.triangle", "book", "graduationcap", "doc.text", "list.bullet", "checkmark.circle", "person.2",
].map((name) => ({ name }));

export function IconPicker({ windowId, sidebarWidth }: { windowId: string; sidebarWidth: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  const side = useSidebarSide(windowId);
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} side={side} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

function besideSidebar(anchor: Picker["anchor"], sidebarWidth: number, side: SidebarSide, roomWidth: number) {
  const { sidebarGap } = ICON_PICKER;
  if (side === "right") {
    const edge = roomWidth - sidebarWidth - sidebarGap;
    return (anchor ? Math.max(edge, anchor.x - sidebarGap) : edge) - ICON_PICKER_WIDTH;
  }
  return anchor ? Math.min(sidebarWidth + sidebarGap, anchor.x + anchor.width + sidebarGap) : sidebarWidth + sidebarGap;
}

function PickerPanel({ picker, sidebarWidth, side }: { picker: Picker; sidebarWidth: number; side: SidebarSide }) {
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useIconPickerCurrent(picker.kind, picker.id, liveIcon);
  const close = () => setSidebarUi({ iconPicker: null });
  const choose = (icon: string | null) => {
    setIcon(picker, icon);
    close();
  };
  const { anchor } = picker;
  const { windowMargin } = ICON_PICKER;
  const actions: PickerAction[] = [
    ...(picker.kind === "group" ? [{ title: "No Icon", icon: "square.stack.fill", primary: current === NO_GROUP_ICON, onPress: () => choose(NO_GROUP_ICON) }] : []),
    ...(current ? [{ title: "Reset Icon", onPress: () => choose(null) }] : []),
  ];

  return (
    <IconPickerLayer
      current={current}
      symbols={SYMBOLS}
      actions={actions}
      onChoose={choose}
      onClose={close}
      placeIn={(height, room) => ({
        top: clampTop((anchor?.y ?? 60) - windowMargin, height, room),
        left: anchor ? clampLeft(besideSidebar(anchor, sidebarWidth, side, room.width), room) : besideSidebar(anchor, sidebarWidth, side, room.width),
      })}
    />
  );
}
