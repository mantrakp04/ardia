import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { useProfiles } from "../../state/browser/hooks";
import { Button, Dot, PopUp, space, Symbol, Text, useTheme } from "../ui";
import { SelectableCard } from "../settings/SelectableCard";
import { APP } from "./model";
import { importLayout, importType } from "./tokens";

export function Title({ title, subtitle, spinner }: { title: string; subtitle?: string; spinner?: boolean }) {
  return (
    <View style={{ marginBottom: space.xxl }}>
      <Text weight="bold" style={importType.heading}>
        {title}
      </Text>
      {subtitle ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m, marginTop: space.s }}>
          {spinner && <ActivityIndicator size="small" />}
          <Text tone="textSecondary" style={{ flex: 1, lineHeight: importType.bodyLine }}>
            {subtitle}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function Note({ text }: { text: string }) {
  return (
    <Text tone="textSecondary" style={{ marginTop: space.xxl, textAlign: "center" }}>
      {text}
    </Text>
  );
}

export function ErrorText({ text }: { text: string }) {
  return (
    <Text size="caption" tone="destructive" style={{ marginTop: space.l }}>
      {text}
    </Text>
  );
}

export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

export function TargetPicker({ target, onChange }: { target: string; onChange: (id: string) => void }) {
  const profiles = useProfiles();
  return profiles.length > 1 ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
      <Text size="small" tone="textSecondary">
        Import into
      </Text>
      <PopUp value={target} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={onChange} minWidth={130} />
    </View>
  ) : (
    <View />
  );
}

export function SettingsSteps({ steps, openTitle, onOpen, onRecheck }: { steps: string[]; openTitle: string; onOpen: () => void; onRecheck: () => void }) {
  return (
    <>
      <View style={{ gap: space.ml, marginBottom: space.xl }}>
        {steps.map((t, i) => (
          <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: space.ml }}>
            <StepBadge>{i + 1}</StepBadge>
            <Text>{t}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.ml }}>
        <Button title={openTitle} kind="primary" onPress={onOpen} />
        <Button title="Check Again" onPress={onRecheck} />
      </View>
    </>
  );
}

function StepBadge({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Dot size={importLayout.stepBadge} color={theme.rowHover}>
      <Text size="caption" weight="semibold" tone="textSecondary">
        {children}
      </Text>
    </Dot>
  );
}

export function FullDiskAccessSteps({ onOpen, onRecheck }: { onOpen: () => void; onRecheck: () => void }) {
  return (
    <SettingsSteps
      steps={["Click “Open Full Disk Access Settings” below", `Turn on ${APP} in the list`, "Come back here: we'll continue automatically"]}
      openTitle="Open Full Disk Access Settings"
      onOpen={onOpen}
      onRecheck={onRecheck}
    />
  );
}

export function FileDrop({ onFile, onChoose }: { onFile: (path: string) => void; onChoose: () => Promise<string | null> }) {
  const theme = useTheme();
  const [over, setOver] = useState(false);
  return (
    <View
      draggedTypes={["fileUrl"]}
      onDragEnter={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const uri = e.nativeEvent.dataTransfer?.files?.[0]?.uri;
        if (uri) onFile(decodeURIComponent(uri.replace(/^file:\/\//, "")));
      }}
    >
      <SelectableCard selected={over} dashed style={DROP}>
        <Symbol name="doc.zipper" size={24} color={theme.textSecondary} style={{ width: 32, height: 32 }} />
        <Text tone="textSecondary">Choose .zip file or drag it here</Text>
        <Button
          title="Choose .zip file"
          onPress={() =>
            void onChoose().then((path) => {
              if (path) onFile(path);
            })
          }
        />
      </SelectableCard>
    </View>
  );
}

const DROP = { height: importLayout.dropHeight, alignItems: "center", justifyContent: "center", gap: space.ml } as const;

export function Handoff({ iconPath, symbol, lead, detail }: { iconPath?: string; symbol: string; lead: string; detail: string }) {
  const theme = useTheme();
  const icon = importLayout.appIcon;
  return (
    <View style={{ alignItems: "center", marginTop: space.ml, gap: space.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xl }}>
        {iconPath ? <Image source={{ uri: `file://${iconPath}` }} style={{ width: icon, height: icon }} /> : null}
        <Symbol name="arrow.right" size={16} color={theme.textTertiary} style={{ width: 20, height: 20 }} />
        <Symbol name={symbol} size={30} color={theme.icon} style={{ width: icon, height: icon }} />
      </View>
      <Text style={{ lineHeight: importType.bodyLine, textAlign: "center", maxWidth: importLayout.textMax }}>{lead}</Text>
      <Text size="small" tone="textSecondary" style={{ lineHeight: importType.smallLine, textAlign: "center", maxWidth: importLayout.textMax }}>
        {detail}
      </Text>
    </View>
  );
}
