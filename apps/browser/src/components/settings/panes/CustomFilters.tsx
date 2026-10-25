import {
  addFilterList,
  getContentBlocker,
  getUserFilters,
  removeFilterList,
  setContentBlockerEnabled,
  setFilterListEnabled,
  setUserFilters,
  updateFilterList,
  type ContentBlockerState,
  type CustomFilterList,
} from "@ardia/ardiacore";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { Button, Checkbox, Group, Row, SectionHeader, Sheet, TextField, useFormColors } from "../controls";
import { showSettingsSheet } from "../sheet";

type Status = { kind: "busy" | "error" | "done"; text: string } | null;

const LIST_URL = /^https?:\/\/[^\s/?#]+\S*$/i;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^.*ERR_CONTENT_BLOCKER[^:]*:\s*/, "");

const filtersText = (n: number) => `${n.toLocaleString()} ${n === 1 ? "filter" : "filters"}`;

const rulesText = (n: number) => `${n.toLocaleString()} ${n === 1 ? "rule" : "rules"}`;

function agoText(ms: number, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function listUrlProblem(url: string, lists: CustomFilterList[]) {
  if (!LIST_URL.test(url)) return "Enter the list's full address, starting with http:// or https://.";
  if (lists.some((l) => l.id === url)) return "You already have this list.";
  return null;
}

const displayTitle = (l: CustomFilterList) => l.title || l.id.replace(/^https?:\/\//, "");

export function CustomFiltersSection({ blocker, refresh, back }: { blocker: ContentBlockerState | null; refresh: () => void; back: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [listErrors, setListErrors] = useState<Record<string, string>>({});
  const addingRef = useRef(false);
  const actingRef = useRef(new Set<string>());
  const lists = blocker?.customLists ?? [];
  const adding = status?.kind === "busy";

  const turnOnBlocking = async () => {
    if (blocker && !blocker.enabled) await setContentBlockerEnabled(true);
  };

  const add = async () => {
    if (!blocker || addingRef.current) return;
    const wanted = url.trim();
    const problem = listUrlProblem(wanted, lists);
    if (problem) return setStatus({ kind: "error", text: problem });
    addingRef.current = true;
    setStatus({ kind: "busy", text: "Downloading the list…" });
    try {
      const added = await addFilterList(wanted);
      setUrl("");
      try {
        await turnOnBlocking();
      } catch (e) {
        return setStatus({ kind: "error", text: `Added ${added.title || "the list"}, but couldn't turn blocking on: ${errorText(e)}` });
      }
      setStatus({
        kind: "done",
        text: added.builtIn
          ? `That's ${added.title}, one of the built-in lists. It's on now.`
          : `Added ${added.title || "the list"} with ${filtersText(added.filters)}.`,
      });
    } catch (e) {
      setStatus({ kind: "error", text: errorText(e) });
    } finally {
      addingRef.current = false;
      refresh();
    }
  };

  const act = async (l: CustomFilterList, what: string, run: () => Promise<void>) => {
    if (actingRef.current.has(l.id)) return;
    actingRef.current.add(l.id);
    setBusy((b) => ({ ...b, [l.id]: what }));
    setListErrors(({ [l.id]: _, ...rest }) => rest);
    try {
      await run();
    } catch (e) {
      setListErrors((errors) => ({ ...errors, [l.id]: errorText(e) }));
    } finally {
      actingRef.current.delete(l.id);
      setBusy(({ [l.id]: _, ...rest }) => rest);
      refresh();
    }
  };

  const describe = (l: CustomFilterList) => {
    const error =
      listErrors[l.id] ||
      (l.enabled && !l.downloaded ? l.error || "Not downloaded yet." : l.enabled && l.error ? "The last update failed. Its filters from before still apply." : "");
    if (busy[l.id]) return <Text style={{ fontSize: 11.5, marginTop: 2, color: theme.textSecondary }}>{busy[l.id]}</Text>;
    const parts = [l.enabled ? filtersText(l.filters) : "Off", l.updatedAt ? `Updated ${agoText(l.updatedAt)}` : ""].filter(Boolean);
    return (
      <View>
        <Text numberOfLines={1} style={{ fontSize: 11.5, marginTop: 2, color: theme.textSecondary }}>
          {parts.join(" · ")}
        </Text>
        <Text numberOfLines={1} selectable style={{ fontSize: 11, marginTop: 1, color: theme.textTertiary }}>
          {l.id}
        </Text>
        {error ? <Text style={{ fontSize: 11.5, marginTop: 2, color: colors.destructive }}>{error}</Text> : null}
      </View>
    );
  };

  return (
    <>
      <SectionHeader title="Custom filter lists" description="Add uBlock Origin filter lists by their address. They update with the built-in lists, in every profile." />
      <Group>
        {lists.map((l) => (
          <Row
            key={l.id}
            title={
              <Checkbox
                value={l.enabled}
                disabled={!!busy[l.id]}
                onChange={(on) =>
                  void act(l, on ? "Turning on…" : "Turning off…", async () => {
                    await setFilterListEnabled(l.id, on);
                    if (on) await turnOnBlocking();
                  })
                }
                label={displayTitle(l)}
              />
            }
            description={describe(l)}
          >
            <Button title="Update" disabled={!l.enabled || !!busy[l.id]} onPress={() => void act(l, "Updating…", () => updateFilterList(l.id))} />
            <Button title="Remove" disabled={!!busy[l.id]} onPress={() => void act(l, "Removing…", () => removeFilterList(l.id))} />
          </Row>
        ))}
        <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextField
              value={url}
              onChangeText={(text) => {
                setUrl(text);
                if (status?.kind !== "busy") setStatus(null);
              }}
              placeholder="https://example.com/filters.txt"
              onSubmit={() => void add()}
              style={{ flex: 1 }}
            />
            <Button title="Add List" kind="primary" disabled={!blocker || adding || !url.trim()} onPress={() => void add()} />
          </View>
          {status ? (
            <Text
              style={{
                fontSize: 11.5,
                marginTop: 6,
                lineHeight: 15,
                color: status.kind === "error" ? colors.destructive : theme.textSecondary,
              }}
            >
              {status.text}
            </Text>
          ) : null}
        </View>
        <Row
          title="My filters"
          description={blocker?.userFilters ? `${rulesText(blocker.userFilters)} in use.` : "Your own rules, in uBlock Origin's syntax."}
          onPress={blocker ? () => showSettingsSheet(<MyFiltersSheet onSaved={refresh} back={back} />) : undefined}
        />
      </Group>
    </>
  );
}

function MyFiltersSheet({ onSaved, back }: { onSaved: () => void; back: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const savingRef = useRef(false);

  const load = () => {
    setStatus(null);
    getUserFilters()
      .then((t) => {
        setText(t);
        setSaved(t);
      })
      .catch((e) => setStatus({ kind: "error", text: `Couldn't read your filters: ${errorText(e)}` }));
  };
  useEffect(load, []);

  const save = async () => {
    if (text === null || savingRef.current) return;
    savingRef.current = true;
    setStatus({ kind: "busy", text: "Saving…" });
    try {
      await setUserFilters(text);
      setSaved(text);
      onSaved();
      try {
        if (text.trim() && !(await getContentBlocker()).enabled) await setContentBlockerEnabled(true);
      } catch (e) {
        return setStatus({ kind: "error", text: `Saved, but couldn't turn blocking on: ${errorText(e)}` });
      }
      setStatus({ kind: "done", text: "Saved. Reload a page to see the change." });
    } catch (e) {
      setStatus({ kind: "error", text: errorText(e) });
    } finally {
      savingRef.current = false;
    }
  };

  const close = () => {
    if (!savingRef.current) back();
  };

  const dirty = text !== null && text !== saved;
  return (
    <Sheet width={560} onClose={close}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>My Filters</Text>
      <Text style={{ fontSize: 12, marginTop: 4, lineHeight: 16, color: theme.textSecondary }}>
        {"One rule per line, in uBlock Origin's syntax. To hide something on one site: x.com##[role=\"menuitem\"]:has-text(Send via Chat)"}
      </Text>
      <View
        style={{
          marginTop: 12,
          height: 260,
          borderRadius: 7,
          padding: 8,
          backgroundColor: colors.field,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: status?.kind === "error" ? colors.destructive : colors.fieldBorder,
        }}
      >
        <TextInput
          value={text ?? ""}
          editable={text !== null && status?.kind !== "busy"}
          onChangeText={(t) => {
            setText(t);
            if (status?.kind !== "busy") setStatus(null);
          }}
          multiline
          autoFocus
          placeholder={"youtube.com##ytd-reel-shelf-renderer\n||ads.example.com^"}
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.selection}
          enableFocusRing={false}
          autoCorrect={false}
          spellCheck={false}
          style={{ flex: 1, fontSize: 12, lineHeight: 17, color: theme.textPrimary, fontFamily: "Menlo" }}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }}>
        <Text style={{ flex: 1, fontSize: 11.5, lineHeight: 15, color: status?.kind === "error" ? colors.destructive : theme.textSecondary }}>
          {status?.text ?? ""}
        </Text>
        {text === null && status?.kind === "error" ? <Button title="Try Again" onPress={load} /> : null}
        <Button title={dirty ? "Cancel" : "Done"} disabled={status?.kind === "busy"} onPress={close} />
        <Button title="Save" kind="primary" disabled={!dirty || status?.kind === "busy"} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}
