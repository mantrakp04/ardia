import { Pressable, View } from "react-native";
import { setAttach, setAttachedOpen, setPreview } from "../../state/report/actions";
import type { AttachmentKey } from "../../state/report/form";
import { useReport, useReportShallow } from "../../state/report/hooks";
import { Box, Button, Checkbox, Divider, space, Symbol, Text, useHover, useTheme } from "../ui";

const shortAddress = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "");

export function useAttachedRows() {
  const { attach, local, pageAddress, systemLine } = useReportShallow((s) => ({ attach: s.draft.attach, local: s.local, pageAddress: s.pageAddress, systemLine: s.systemLine }));
  const events = local?.lines ?? 0;
  const rows: { key: AttachmentKey; title: string; detail: string; on: boolean; disabled?: boolean }[] = [
    { key: "system", title: "System info", detail: systemLine, on: attach.system },
    { key: "errors", title: "Usage, errors and crashes, last 7 days", detail: local ? `${events} ${events === 1 ? "event" : "events"}` : "Reading…", on: attach.errors && events > 0, disabled: !events },
    { key: "settings", title: "Settings", detail: "No passwords or history", on: attach.settings },
    { key: "page", title: "Page address", detail: pageAddress ? shortAddress(pageAddress) : "No page open", on: attach.page && !!pageAddress, disabled: !pageAddress },
  ];
  const summary = [
    attach.system ? "System info" : null,
    attach.errors && events ? `${events} ${events === 1 ? "event" : "events"}` : null,
    attach.settings ? "settings" : null,
    attach.page && pageAddress ? "page address" : null,
  ].filter(Boolean);
  return { rows, summary: summary.length ? summary.join(", ") : "Nothing" };
}

export function AttachedRow() {
  const theme = useTheme();
  const open = useReport((s) => s.attachedOpen);
  const { rows, summary } = useAttachedRows();
  const { hovered, hoverProps } = useHover();
  return (
    <Box fill="groupFill" border="groupBorder" radius="panel" style={CLIP}>
      <View {...hoverProps}>
        <Pressable onPress={() => setAttachedOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Attached: ${summary}. Preview`}>
          <Box row gap="m" padX="l" fill={hovered ? "rowHover" : undefined} style={ROW}>
            <Symbol name="paperclip" size={12} color={theme.textSecondary} style={GLYPH} />
            <Text tone="textSecondary">Attached</Text>
            <Text numberOfLines={1} style={FLEX}>
              {summary}
            </Text>
            <Text weight="medium" tone="formAccent">
              Preview
            </Text>
            <Symbol name={open ? "chevron.up" : "chevron.down"} size={10} weight="semibold" color={theme.textSecondary} style={GLYPH} />
          </Box>
        </Pressable>
      </View>
      {open ? <AttachedList rows={rows} /> : null}
    </Box>
  );
}

function AttachedList({ rows }: { rows: ReturnType<typeof useAttachedRows>["rows"] }) {
  return (
    <>
      <Divider />
      <View style={LIST}>
        <Text size="small" weight="semibold" tone="textSecondary" style={{ marginBottom: space.xs }}>
          Sent with this report
        </Text>
        {rows.map((row) => (
          <Pressable key={row.key} disabled={row.disabled} onPress={() => setAttach(row.key, !row.on)}>
            <Box row gap="m" style={ITEM}>
              <Checkbox value={row.on} disabled={row.disabled} onChange={(on) => setAttach(row.key, on)} />
              <Text tone={row.disabled ? "textTertiary" : "textPrimary"}>{row.title}</Text>
              <Text size="small" tone="textTertiary" numberOfLines={1} style={DETAIL}>
                {row.detail}
              </Text>
            </Box>
          </Pressable>
        ))}
        <View style={{ marginTop: space.s, alignSelf: "flex-start" }}>
          <Button variant="text" look="link" pad="none" title="Preview everything that's sent" onPress={() => setPreview(true)} />
        </View>
      </View>
    </>
  );
}

const FLEX = { flex: 1 } as const;
const ROW = { height: 34, alignItems: "center" } as const;
const CLIP = { overflow: "hidden" } as const;
const LIST = { paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.m } as const;
const ITEM = { height: 26, alignItems: "center" } as const;
const DETAIL = { flex: 1, textAlign: "right" } as const;
const GLYPH = { width: 14, height: 14 } as const;
