import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { previewPayload, reportFiles, setPreview } from "../../state/report/actions";
import { formatBytes, type ReportFile } from "../../state/report/form";
import { Box, Button, DialogActions, DialogTitle, radius, space, Text, useTheme } from "../ui";
import { REPORT } from "./tokens";

export function ReportPreview() {
  const theme = useTheme();
  const [payload, setPayload] = useState<string>("");
  const [files, setFiles] = useState<ReportFile[]>([]);
  useEffect(() => {
    setFiles(reportFiles());
    void previewPayload().then((p) => setPayload(JSON.stringify(p, null, 2)));
  }, []);
  return (
    <>
      <DialogTitle subtitle="Exactly what leaves your Mac when you press Send. Only the title, description, kind and version go to the public GitHub issue.">
        What's sent
      </DialogTitle>
      <View style={{ marginTop: space.xl, height: REPORT.previewHeight, borderRadius: radius.tile, backgroundColor: theme.groupFill, borderColor: theme.groupBorder, borderWidth: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.l }}>
          <Text size="small" weight="semibold" tone="textSecondary">
            Report
          </Text>
          <Text size="small" selectable style={MONO}>
            {payload || "…"}
          </Text>
          <Text size="small" weight="semibold" tone="textSecondary" style={{ marginTop: space.l }}>
            Files
          </Text>
          {files.length ? (
            files.map((f) => (
              <Box key={f.name} row gap="m">
                <Text size="small" style={MONO}>
                  {f.name}
                </Text>
                <Text size="small" tone="textSecondary">
                  {formatBytes(f.bytes)}
                </Text>
              </Box>
            ))
          ) : (
            <Text size="small" tone="textSecondary">
              None
            </Text>
          )}
        </ScrollView>
      </View>
      <DialogActions>
        <Button title="Back" onPress={() => setPreview(false)} />
      </DialogActions>
    </>
  );
}

const MONO = { fontFamily: "Menlo" } as const;
