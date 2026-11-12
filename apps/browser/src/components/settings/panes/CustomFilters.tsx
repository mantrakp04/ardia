import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { UI_LOCALE } from "../../../lib/uiLocale";
import { showSettingsSheet } from "../../../state/settings/sheet";
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
} from "../../../state/site/siteSettings";
import { Button, Checkbox, DialogActions, DialogTitle, Sheet, space, Text, TextField } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

type Status = { kind: "busy" | "error" | "done"; text: string } | null;

const LIST_URL = /^https?:\/\/[^\s/?#]+\S*$/i;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^.*ERR_CONTENT_BLOCKER[^:]*:\s*/, "");

const filtersText = (n: number) => `${n.toLocaleString(UI_LOCALE)} ${n === 1 ? "filter" : "filters"}`;

const rulesText = (n: number) => `${n.toLocaleString(UI_LOCALE)} ${n === 1 ? "rule" : "rules"}`;

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

const ADD_ROW = { paddingHorizontal: space.l, paddingVertical: space.m } as const;
const ADD_FIELDS = { flexDirection: "row", alignItems: "center", gap: space.m } as const;
const GROW = { flex: 1 } as const;
const STATUS_LINE = { marginTop: space.s } as const;
const DETAIL_LINE = { marginTop: space.xxs } as const;
const EDITOR = { marginTop: space.l } as const;
const EDITOR_HEIGHT = 260;

export function CustomFiltersSection({ blocker, refresh, back }: { blocker: ContentBlockerState | null; refresh: () => void; back: () => void }) {
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

  const act = async (l: CustomFilterList, what: string, run: () => Promise<unknown>) => {
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
    if (busy[l.id])
      return (
        <Text size="small" tone="textSecondary" style={DETAIL_LINE}>
          {busy[l.id]}
        </Text>
      );
    const parts = [l.enabled ? filtersText(l.filters) : "Off", l.updatedAt ? `Updated ${agoText(l.updatedAt)}` : ""].filter(Boolean);
    return (
      <View>
        <Text size="small" tone="textSecondary" lines={1} style={DETAIL_LINE}>
          {parts.join(" · ")}
        </Text>
        <Text size="caption" tone="textTertiary" lines={1} selectable>
          {l.id}
        </Text>
        {error ? (
          <Text size="small" tone="destructive" style={DETAIL_LINE}>
            {error}
          </Text>
        ) : null}
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
        <View style={ADD_ROW}>
          <View style={ADD_FIELDS}>
            <TextField
              value={url}
              onChangeText={(text) => {
                setUrl(text);
                if (status?.kind !== "busy") setStatus(null);
              }}
              placeholder="https://example.com/filters.txt"
              onSubmit={() => void add()}
              style={GROW}
            />
            <Button title="Add List" kind="primary" disabled={!blocker || adding || !url.trim()} onPress={() => void add()} />
          </View>
          {status ? (
            <Text size="small" tone={status.kind === "error" ? "destructive" : "textSecondary"} style={STATUS_LINE}>
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
    <Sheet size="xl" onClose={close}>
      <DialogTitle subtitle={"One rule per line, in uBlock Origin's syntax. To hide something on one site: x.com##[role=\"menuitem\"]:has-text(Send via Chat)"}>My Filters</DialogTitle>
      <TextField
        value={text ?? ""}
        editable={text !== null && status?.kind !== "busy"}
        onChangeText={(t) => {
          setText(t);
          if (status?.kind !== "busy") setStatus(null);
        }}
        multiline
        mono
        autoFocus
        invalid={status?.kind === "error"}
        height={EDITOR_HEIGHT}
        placeholder={"youtube.com##ytd-reel-shelf-renderer\n||ads.example.com^"}
        style={EDITOR}
      />
      <DialogActions
        note={
          <Text size="small" tone={status?.kind === "error" ? "destructive" : "textSecondary"}>
            {status?.text ?? ""}
          </Text>
        }
      >
        {text === null && status?.kind === "error" ? <Button title="Try Again" onPress={load} /> : null}
        <Button title={dirty ? "Cancel" : "Done"} disabled={status?.kind === "busy"} onPress={close} />
        <Button title="Save" kind="primary" disabled={!dirty || status?.kind === "busy"} onPress={() => void save()} />
      </DialogActions>
    </Sheet>
  );
}
