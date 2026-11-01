import type { SearchScope } from "@ardia/core";
import type { ReactNode, RefObject } from "react";
import { View } from "react-native";
import { Button, capsule, ContextMenuArea, useHover, useTheme } from "../ui";
import { GlassFill, useGlass } from "../ui/Glass";
import { GoButton } from "./GoButton";
import { ScopeChip } from "./ScopeChip";
import { BAR, GO_BUTTON } from "./tokens";

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
              size="l"
              glyph={BAR.siteControls.glyph}
              capsule
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
      <DictateButton onPress={onDictate} />
      <GoButton label={label} enabled={enabled} onPress={onGo} />
    </View>
  );
}

function DictateButton({ onPress }: { onPress(): void }) {
  const theme = useTheme();
  const glass = useGlass();
  const { hovered, hoverProps } = useHover();
  if (!glass) return <Button variant="icon" icon="mic" glyph={BAR.bottom.mic} color={theme.textTertiary} tooltip="Dictate" onPress={onPress} />;
  return (
    <View {...hoverProps}>
      <GlassFill radius={capsule(GO_BUTTON.height)} state={hovered ? "lit" : "rest"} />
      <Button
        variant="icon"
        icon="mic"
        box={GO_BUTTON.height}
        capsule
        glyph={BAR.bottom.mic}
        color={theme.textTertiary}
        palette={{ icon: theme.textTertiary, iconDisabled: theme.iconDisabled, hover: "transparent", pressed: theme.toolbarPressed }}
        tooltip="Dictate"
        onPress={onPress}
      />
    </View>
  );
}
