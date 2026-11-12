import { View } from "react-native";
import type { SentReport } from "../../state/report/store";
import { finishReport, viewIssue } from "../../state/report/actions";
import { formatDay } from "../../state/report/form";
import { AnonymousAvatar } from "../settings/AnonymousAvatar";
import { Box, Button, Dialog, Dot, space, Symbol, Text, useTheme } from "../ui";
import { REPORT } from "./tokens";

export function SentView({ sent }: { sent: SentReport }) {
  const theme = useTheme();
  return (
    <Dialog width="l" animated onDismiss={finishReport} onSubmit={finishReport}>
      <View style={COLUMN}>
        <Dot size={REPORT.sentIcon} color={theme.success}>
          <Symbol name="checkmark" size={REPORT.sentGlyph} weight="bold" color={theme.onAccent} style={{ width: REPORT.sentIcon, height: REPORT.sentIcon }} />
        </Dot>
        <Text size="large" weight="semibold" style={{ marginTop: space.l }}>
          {`Sent · ${sent.id}`}
        </Text>
        <Text tone="textSecondary" style={{ marginTop: space.xs }}>
          Thanks. Every report gets read and tracked.
        </Text>
        {sent.issueUrl ? (
          <View style={{ marginTop: space.xs }}>
            <Button variant="text" look="link" title={sent.issueNumber ? `View on GitHub · #${sent.issueNumber}` : "View on GitHub"} onPress={viewIssue} />
          </View>
        ) : null}
      </View>
      <Box row gap="l" pad="l" fill="groupFill" border="groupBorder" radius="panel" style={{ marginTop: space.xl, alignItems: "center" }}>
        <AnonymousAvatar avatar={sent.avatar} size={REPORT.avatar} />
        <View style={FLEX}>
          <Text>
            {"You appear to us as "}
            <Text weight="semibold">{sent.name}</Text>
          </Text>
          <Text size="small" tone="textSecondary">
            A made-up name. No account, no email.
          </Text>
        </View>
      </Box>
      {sent.watchUntil ? (
        <Text size="small" tone="textSecondary" style={{ marginTop: space.l, textAlign: "center" }}>
          {sent.watchTurnsOff
            ? `Crash reports and usage are shared until ${formatDay(sent.watchUntil)} to confirm the fix, then sharing turns itself off. Stop early in Settings › Privacy.`
            : `We'll watch for this problem until ${formatDay(sent.watchUntil)}.`}
        </Text>
      ) : null}
      <View style={{ marginTop: space.xl, alignItems: "center" }}>
        <Button title="Done" kind="primary" onPress={finishReport} />
      </View>
    </Dialog>
  );
}

const COLUMN = { alignItems: "center" } as const;
const FLEX = { flex: 1 } as const;
