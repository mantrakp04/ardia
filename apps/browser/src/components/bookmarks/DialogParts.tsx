import { ScrollView } from "react-native";
import { Box, space, Text } from "../ui";
import { FolderTree } from "./FolderTree";
import { fieldLabel, folderPicker } from "./tokens";

export function FieldLabel({ text }: { text: string }) {
  return (
    <Text size="footnote" tone="textSecondary" style={LABEL}>
      {text}
    </Text>
  );
}

export function FolderPicker({
  profileId,
  selectedId,
  onSelect,
  height,
  clip,
}: {
  profileId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  height: number;
  clip?: boolean;
}) {
  return (
    <Box radius="button" fill="field" border="fieldBorder" style={{ height, overflow: clip ? "hidden" : undefined }}>
      <ScrollView contentContainerStyle={CONTENT}>
        {profileId && <FolderTree profileId={profileId} selectedId={selectedId} onSelect={onSelect} rowHeight={folderPicker.row} />}
      </ScrollView>
    </Box>
  );
}

const LABEL = { marginTop: space.l, marginBottom: fieldLabel.gapBelow } as const;
const CONTENT = { padding: space.xs } as const;
