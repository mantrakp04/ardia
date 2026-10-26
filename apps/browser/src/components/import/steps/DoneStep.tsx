import { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";
import { allArcHolders, restoreArcFolders } from "../../../state/bookmarks/bookmarkGroups";
import { useBookmarks } from "../../../state/bookmarks/hooks";
import { plural } from "../../../state/browser/model";
import { openInWebStore, type ImportCounts } from "../../../state/import/apply";
import { useOnboarding } from "../../../state/onboarding/onboarding";
import { Button, space, Symbol, Text, useTheme } from "../../ui";
import { APP, kindTitle } from "../model";
import { Spacer, Title } from "../Parts";
import { importColors, importLayout, importMotion, importType } from "../tokens";
import type { ImportFlow } from "../useImportFlow";

function summaryOf(counts: ImportCounts) {
  return [
    counts.bookmarks && plural(counts.bookmarks, "bookmark"),
    counts.history && plural(counts.history, "history item"),
    counts.passwords && plural(counts.passwords, "password"),
    counts.cookies && plural(counts.cookies, "cookie"),
    counts.addresses && `${counts.addresses} ${counts.addresses === 1 ? "address" : "addresses"}`,
    counts.cards && plural(counts.cards, "card"),
    counts.tabs && plural(counts.tabs, "tab"),
  ].filter(Boolean) as string[];
}

function ExtensionList({ flow }: { flow: ImportFlow }) {
  const { extensions, source, target } = flow;
  const onboarding = useOnboarding((s) => s.windowId !== null);
  if (!extensions.list.length) return null;
  const centered = { textAlign: "center" } as const;
  return (
    <View style={{ alignSelf: "stretch", marginTop: space.lx, gap: space.m }}>
      <Text size="small" tone="textSecondary" style={centered}>
        {`${source?.name ?? "Your browser"} has ${plural(extensions.list.length, "extension")} from the Chrome Web Store. Add the ones you want there:`}
      </Text>
      <Text size="small" style={centered} numberOfLines={3}>
        {extensions.list.map((e) => e.name).join(", ")}
      </Text>
      {extensions.opened ? (
        <Text size="small" tone="textSecondary" style={centered}>
          {`${extensions.list.length === 1 ? "Its page is" : "Their pages are"} open in your sidebar${onboarding ? ", ready when you finish setting up" : ""}. Click Add to ${APP} on each one you want.`}
        </Text>
      ) : (
        <View style={{ alignItems: "center" }}>
          <Button
            title={extensions.list.length === 1 ? "Open in Chrome Web Store" : `Open ${extensions.list.length} in Chrome Web Store`}
            onPress={() => {
              openInWebStore(extensions.profileId || target, extensions.list.map((e) => e.webStoreUrl));
              flow.setExtensions((x) => ({ ...x, opened: true }));
            }}
          />
        </View>
      )}
    </View>
  );
}

function LeftBehind({ notes, failed }: { notes: string[]; failed: boolean }) {
  if (!notes.length) return null;
  return (
    <Text size="small" tone="textTertiary" style={{ lineHeight: importType.smallLine, marginTop: space.ml, textAlign: failed ? "left" : "center" }}>
      {notes.join(" ")}
    </Text>
  );
}

function RestoreArcFolders() {
  const bookmarks = useBookmarks((b) => b);
  const arcHolders = useMemo(() => allArcHolders({ bookmarks }), [bookmarks]);
  if (!arcHolders.length) return null;
  return (
    <Button
      title="Restore Arc Folders as Groups"
      onPress={() => {
        for (const id of arcHolders) restoreArcFolders(id, null);
      }}
    />
  );
}

export function DoneBody({ flow }: { flow: ImportFlow }) {
  const { counts, failures, notes } = flow;
  const summary = summaryOf(counts);
  if (failures.length)
    return (
      <>
        <Title title={summary.length ? "Partially imported" : "Import failed"} subtitle="Only some of your data imported. Please try again!" />
        <Text weight="semibold" style={{ marginBottom: space.s }}>
          Some import steps failed:
        </Text>
        {failures.map((f) => (
          <Text key={f.kind} tone="textSecondary" style={{ marginBottom: 3 }}>
            {f.profiles.length ? `${kindTitle(f.kind)} import failed for profiles ${f.profiles.join(", ")}` : `${kindTitle(f.kind)} import failed`}
          </Text>
        ))}
        {summary.length > 0 && <Text size="small" tone="textSecondary" style={{ marginTop: space.l }}>{`Imported ${summary.join(", ")}.`}</Text>}
        <LeftBehind notes={notes} failed />
        <ExtensionList flow={flow} />
        <Text size="small" tone="textTertiary" style={{ marginTop: space.l }}>
          You can retry the import later from the app menu.
        </Text>
      </>
    );
  return (
    <View style={{ alignItems: "center", marginTop: importLayout.doneTop, gap: space.l }}>
      <SuccessMark />
      <Text weight="semibold" style={{ fontSize: importType.done }}>
        You're all set
      </Text>
      <Text tone="textSecondary" style={{ textAlign: "center" }}>
        {summary.length ? `Imported ${summary.join(", ")}.` : "There was nothing new to import."}
      </Text>
      <LeftBehind notes={notes} failed={false} />
      <ExtensionList flow={flow} />
      <RestoreArcFolders />
    </View>
  );
}

export function DoneFooter({ flow }: { flow: ImportFlow }) {
  const failed = flow.failures.length > 0;
  return (
    <>
      <Spacer />
      {failed && <Button title="Try Again" onPress={() => flow.setStep("choose")} />}
      <Button title={failed ? "Continue" : "Finish importing"} kind="primary" onPress={flow.close} />
    </>
  );
}

function SuccessMark() {
  const theme = useTheme();
  const { success } = importMotion;
  const scale = useRef(new Animated.Value(success.from)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: success.friction, tension: success.tension, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Symbol name="checkmark.circle.fill" size={46} color={theme.success} style={{ width: 60, height: 60 }} />
    </Animated.View>
  );
}
