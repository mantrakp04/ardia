import { View } from "react-native";
import { Button, Checkbox, space, Text } from "../../ui";
import { APP, DIA_NOT_SHARED, KINDS, type ImportKind } from "../model";
import { ErrorText, Note, Spacer, TargetPicker, Title } from "../Parts";
import { BrowserRow } from "../Rows";
import { importType } from "../tokens";
import type { ImportFlow } from "../useImportFlow";

const HIDDEN_KINDS: ImportKind[] = ["spaces", "pinnedTabs"];

export function ChooseBody({ flow }: { flow: ImportFlow }) {
  const { api, browsers, source, kinds, bySpaces, error } = flow;
  const appTabs = !!source?.asksAppForTabs;
  const shown = !source
    ? []
    : KINDS.filter((k) => source.profiles.some((p) => p.available.includes(k.kind)) && (!HIDDEN_KINDS.includes(k.kind) || (appTabs && k.kind === "pinnedTabs")));
  return (
    <>
      <Title title="Import from Another Browser" subtitle="Import once and stay in your flow. Your tabs, passwords, bookmarks and history come with you, and you stay signed in." />
      {!api ? (
        <Note text={`Importing isn't available in this build of ${APP}.`} />
      ) : browsers.length === 0 ? (
        <Note text="No other browsers with data to import were found on this Mac." />
      ) : (
        <View style={{ gap: space.s }}>
          {browsers.map((b) => (
            <BrowserRow key={b.id} browser={b} selected={source?.id === b.id} onPress={() => flow.choose(b)} />
          ))}
        </View>
      )}
      {source && !source.requiresExport && !source.needsFullDiskAccess && (
        <View style={{ marginTop: space.xlx }}>
          <Text size="small" weight="semibold" tone="textSecondary" style={{ marginBottom: space.m }}>
            What to import
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lx }}>
            {shown.map((k) => (
              <Checkbox
                key={k.kind}
                label={k.kind === "tabs" && bySpaces ? "Spaces and tabs" : k.kind === "tabs" && appTabs ? "Open tabs" : k.kind === "favorites" && source.sidebar === "zen" ? "Essentials" : k.title}
                value={kinds.has(k.kind)}
                onChange={(v) =>
                  flow.setKinds((prev) => {
                    const n = new Set(prev);
                    if (v) n.add(k.kind);
                    else n.delete(k.kind);
                    return n;
                  })
                }
              />
            ))}
          </View>
          {appTabs && (
            <Text size="small" tone="textSecondary" style={{ lineHeight: importType.smallLine, marginTop: space.ml }}>
              {`${APP} asks Dia for its open and pinned tabs, opening it in the background if it isn't running. ${DIA_NOT_SHARED}`}
            </Text>
          )}
        </View>
      )}
      {error && <ErrorText text={error} />}
    </>
  );
}

export function ChooseFooter({ flow }: { flow: ImportFlow }) {
  const { api, source, kinds } = flow;
  return (
    <>
      {api ? <Button title="Bookmarks HTML File…" onPress={() => void flow.importHtml()} /> : null}
      <Spacer />
      <TargetPicker target={flow.target} onChange={flow.setTarget} />
      <Button title="Cancel" onPress={flow.close} />
      <Button title="Continue" kind="primary" disabled={!source || (!source.requiresExport && !source.needsFullDiskAccess && kinds.size === 0)} onPress={flow.next} />
    </>
  );
}
