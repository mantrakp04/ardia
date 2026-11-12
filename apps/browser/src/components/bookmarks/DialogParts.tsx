import { ScrollView } from "react-native";
import { Box, space } from "../ui";
import { FolderTree } from "./FolderTree";
import { folderPicker } from "./tokens";

export function FolderPicker({ profileId, selectedId, onSelect }: { profileId: string | null; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <Box radius="tile" fill="field" border="fieldBorder" style={FRAME}>
      <ScrollView contentContainerStyle={CONTENT}>
        {profileId && <FolderTree profileId={profileId} selectedId={selectedId} onSelect={onSelect} rowHeight={folderPicker.row} />}
      </ScrollView>
    </Box>
  );
}

const FRAME = { height: folderPicker.height, overflow: "hidden" } as const;
const CONTENT = { padding: space.xs } as const;
