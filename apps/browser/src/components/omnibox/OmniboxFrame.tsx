import type { SearchScope } from "@ardia/core";
import type { ReactNode, RefObject } from "react";
import { View } from "react-native";
import { Button, ContextMenuArea, useTheme } from "../ui";
import { GoButton } from "./GoButton";
import { ScopeChip } from "./ScopeChip";
import { BAR } from "./tokens";

type FrameProps = {
  rootRef: RefObject<View | null>;
  onContextMenu(): void;
  leadingIcon: ReactNode;
  scope: SearchScope | null;
  field: ReactNode;
  list: ReactNode;
};

const ICON_SLOT = { width: BAR.iconSlot, alignItems: "center" } as const;

export function DropdownFrame({ rootRef, onContextMenu, leadingIcon, scope, field, list, onSiteControls }: FrameProps & { onSiteControls: (() => void) | null }) {
  const theme = useTheme();
  return (
    <View ref={rootRef}>
      <ContextMenuArea captureDescendants onContextMenu={onContextMenu}>
        <View style={{ flexDirection: "row", alignItems: "center", height: BAR.dropdown.height, paddingLeft: BAR.dropdown.left, paddingRight: BAR.dropdown.right, gap: BAR.dropdown.gap }}>
          <View style={ICON_SLOT}>{leadingIcon}</View>
          {scope && <ScopeChip scope={scope} large={false} />}
          {field}
          {onSiteControls ? (
            <Button variant="icon"
              icon="info.circle"
              size={BAR.siteControls.icon}
              box={BAR.siteControls.box}
              radius={BAR.siteControls.radius}
              color={theme.textSecondary}
              tooltip="Site Controls"
              onPress={onSiteControls}
            />
          ) : null}
        </View>
      </ContextMenuArea>
      {list}
    </View>
  );
}

export function PanelFrame({ rootRef, onContextMenu, leadingIcon, scope, field, list, hero, rowHeight, bottom }: FrameProps & { hero: boolean; rowHeight: number; bottom: ReactNode }) {
  return (
    <View ref={rootRef}>
      <ContextMenuArea captureDescendants onContextMenu={onContextMenu}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: hero ? BAR.panel.heroHeight : rowHeight,
            paddingLeft: hero ? BAR.panel.heroIconLeft : BAR.panel.iconLeft,
            paddingRight: BAR.panel.right,
            gap: hero ? BAR.panel.heroGap : BAR.panel.gap,
          }}
        >
          <View style={ICON_SLOT}>{leadingIcon}</View>
          {scope && <ScopeChip scope={scope} large={hero} />}
          {field}
        </View>
      </ContextMenuArea>
      {list}
      {bottom}
    </View>
  );
}

export function BottomRow({ hero, addChip, onDictate, label, enabled, onGo }: { hero: boolean; addChip: ReactNode; onDictate(): void; label: string; enabled: boolean; onGo(): void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: hero ? BAR.bottom.heroLeft : BAR.bottom.left,
        paddingRight: hero ? BAR.bottom.heroRight : BAR.bottom.right,
        height: hero ? BAR.bottom.heroHeight : BAR.bottom.height,
        marginBottom: hero ? BAR.bottom.heroBelow : 0,
      }}
    >
      {addChip}
      <View style={{ flex: 1 }} />
      <Button variant="icon" icon="mic" size={BAR.bottom.mic} color={theme.textTertiary} tooltip="Dictate" onPress={onDictate} />
      <GoButton label={label} enabled={enabled} onPress={onGo} />
    </View>
  );
}
