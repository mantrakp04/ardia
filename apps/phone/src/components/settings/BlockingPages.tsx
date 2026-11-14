import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { openFromSettings,
  addList,
  applyMyFilters,
  openOutside,
  removeList,
  resetLists,
  setListEnabled,
  trustSite,
  updateLists,
  useBlocking,
  type FilterListInfo,
} from "../../state/settings/actions";
import { popSettings, pushSettings } from "../../state/settings/nav";
import {
  formatNumber,
  listFacts,
  listIsBusy,
  listsStatus,
  listStatus,
  listsText,
  myFiltersCount,
  myFiltersSummary,
  resetMessage,
  rulesText,
  updatedText,
  validListUrl,
} from "../../state/settings/settingsRules";
import { ConfirmDialog, Dialog, dialogLayout, font, radius, settingsLayout, settingsTint, space, Symbol, Toggle, useTheme, type Confirmation } from "../ui";
import { copy } from "../../lib/platformCopy";

const FILTER_SYNTAX_URL = "https://github.com/gorhill/uBlock/wiki/Static-filter-syntax";
import { BarButton, ButtonRow, Divider, EmptyState, Group, IconTile, NavRow, SettingsPage, ToggleRow, ValueRow } from "./SettingsKit";

export function FilterListsPage() {
  const theme = useTheme();
  const state = useBlocking((s) => s.state);
  const busy = useBlocking((s) => s.busy);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const now = Date.now();
  const lists = state?.lists ?? [];
  const groups = useMemo(() => {
    const byGroup = new Map<string, FilterListInfo[]>();
    for (const list of lists) byGroup.set(list.group, [...(byGroup.get(list.group) ?? []), list]);
    return [...byGroup.entries()];
  }, [lists]);
  const enabled = lists.filter((list) => list.isEnabled);
  const updating = busy || Boolean(state?.isUpdating);
  return (
    <SettingsPage title="Filter Lists" onBack={popSettings}>
      <View style={styles.hero}>
        <IconTile icon="shieldLefthalf" tint={settingsTint.ads} side={settingsLayout.heroTile} />
        <Text style={[font.title3, styles.bold, { color: theme.label }]}>Filter Lists</Text>
        <Text style={[font.subheadline, { color: theme.secondaryLabel }]}>{`${listsText(enabled.length)} · ${rulesText(state?.enabledRuleCount ?? 0)}`}</Text>
        <Text style={[font.footnote, { color: state?.isOffline ? theme.destructive : theme.secondaryLabel }]}>
          {listsStatus(updating, Boolean(state?.isOffline), state?.lastUpdated ?? null, now)}
        </Text>
      </View>
      <Group footer="Checked weekly.">
        <ButtonRow title={updating ? "Updating Lists…" : "Update Now"} enabled={!updating} busy={updating} onPress={updateLists} />
      </Group>
      {groups.map(([group, items]) => (
        <Group key={group} header={group}>
          {items.map((list, index) => (
            <ListRow key={list.id} list={list} now={now} divider={index < items.length - 1} />
          ))}
        </Group>
      ))}
      <Group>
        <ButtonRow title="Add a List…" divider onPress={() => setAdding(true)} />
        <NavRow title="My Filters" value={myFiltersCount(state?.myFiltersRuleCount ?? 0)} onPress={() => pushSettings({ page: "myFilters" })} />
      </Group>
      <Group>
        <ButtonRow
          title="Restore Defaults…"
          destructive
          onPress={() =>
            setConfirmation({
              title: "Restore Default Filter Lists?",
              message: resetMessage(lists.filter((list) => list.isCustom).length),
              action: "Restore Defaults",
              run: resetLists,
            })
          }
        />
      </Group>
      {adding ? <AddListDialog onClose={() => setAdding(false)} /> : null}
      {confirmation ? <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} /> : null}
    </SettingsPage>
  );
}

function ListRow({ list, now, divider }: { list: FilterListInfo; now: number; divider: boolean }) {
  const theme = useTheme();
  const facts = listFacts(list, now);
  return (
    <View>
      <View style={styles.listRow}>
        <Pressable accessibilityRole="button" accessibilityHint="Shows the list’s details" onPress={() => pushSettings({ page: "filterList", id: list.id })} style={styles.fill}>
          <Text style={[font.body, { color: theme.label }]} numberOfLines={2}>
            {list.title}
          </Text>
          <Text style={[font.footnote, { color: facts.isWarning ? theme.destructive : theme.secondaryLabel }]}>{facts.text}</Text>
        </Pressable>
        <Toggle label={list.title} value={list.isEnabled} disabled={listIsBusy(list)} onChange={(on) => setListEnabled(list.id, on)} />
      </View>
      {divider ? <Divider /> : null}
    </View>
  );
}

export function FilterListDetailPage({ id }: { id: string }) {
  const list = useBlocking((s) => s.state?.lists.find((item) => item.id === id) ?? null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  if (!list)
    return (
      <SettingsPage title="Filter List" onBack={popSettings}>
        <EmptyState title="List Removed" message="" icon="listBulletFill" />
      </SettingsPage>
    );
  return (
    <SettingsPage title={list.title} onBack={popSettings}>
      <Group footer={list.isDefault ? "On by default in uBlock Origin." : null}>
        <ToggleRow title="Use This List" value={list.isEnabled} onChange={(on) => setListEnabled(list.id, on)} />
      </Group>
      {list.state === "failed" ? (
        <Group footer={list.failure}>
          <ButtonRow title="Try Again" onPress={updateLists} />
        </Group>
      ) : null}
      <Group footer={list.skippedCount > 0 ? copy().filterRulesUnsupported : null}>
        <ValueRow title="Status" value={listStatus(list)} divider />
        <ValueRow title="Last Updated" value={list.updatedAt ? updatedText(list.updatedAt, Date.now()).replace(/^Updated /, "") : "Never"} divider />
        <ValueRow title="Rules" value={formatNumber(list.ruleCount)} divider />
        <ValueRow title="Skipped" value={formatNumber(list.skippedCount)} />
      </Group>
      {list.sourceUrl || list.supportUrl ? (
        <Group header="Source">
          {list.sourceUrl ? <ValueRow title={list.sourceUrl.replace(/^https:\/\//, "")} value="" divider={Boolean(list.supportUrl)} /> : null}
          {list.supportUrl ? <ButtonRow title="Visit the List’s Website" onPress={() => openOutside(list.supportUrl!)} /> : null}
        </Group>
      ) : null}
      {list.isCustom ? (
        <Group>
          <ButtonRow
            title="Remove List…"
            destructive
            onPress={() =>
              setConfirmation({
                title: "Remove This List?",
                message: "You can add it again later.",
                action: "Remove List",
                run: () => {
                  removeList(list.id);
                  popSettings();
                },
              })
            }
          />
        </Group>
      ) : null}
      {confirmation ? <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} /> : null}
    </SettingsPage>
  );
}

function AddListDialog({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const url = validListUrl(text);
  const add = async () => {
    if (!url) return;
    if (await addList(url)) onClose();
    else setFailed(true);
  };
  return (
    <Dialog
      title="Add a List"
      message={failed ? "Couldn’t add that list." : "Adblock Plus or uBlock Origin format."}
      onDismiss={onClose}
      buttons={[
        { title: "Cancel", onPress: onClose },
        { title: "Add", onPress: () => void add() },
      ]}
    >
      <TextInput
        accessibilityLabel="List Address"
        value={text}
        onChangeText={(value) => {
          setText(value);
          setFailed(false);
        }}
        placeholder="https://example.com/filters.txt"
        placeholderTextColor={theme.foregroundTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[font.body, styles.field, { color: theme.label, borderColor: theme.separator }]}
      />
    </Dialog>
  );
}

export function MyFiltersPage() {
  const theme = useTheme();
  const state = useBlocking((s) => s.state);
  const saved = state?.myFilters ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  const changed = draft !== null && draft !== saved;
  const apply = async () => {
    await applyMyFilters(text);
    setDraft(null);
  };
  return (
    <SettingsPage
      title="My Filters"
      onBack={popSettings}
      leading={changed ? <BarButton title="Revert" onPress={() => setDraft(null)} /> : null}
      trailing={<BarButton title="Apply" emphasized enabled={changed} onPress={() => void apply()} />}
    >
      <View style={[styles.editor, { backgroundColor: theme.groupFill }]}>
        <TextInput
          accessibilityLabel="My Filters"
          multiline
          value={text}
          onChangeText={setDraft}
          placeholder={"||ads.example.com^\nexample.com##.newsletter-popup"}
          placeholderTextColor={theme.foregroundTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={[font.subheadline, styles.editorText, { color: theme.label }]}
        />
      </View>
      <View style={styles.footer}>
        <Text style={[font.footnote, { color: changed ? theme.formAccent : theme.secondaryLabel }]}>
          {myFiltersSummary(state?.myFiltersRuleCount ?? 0, state?.myFiltersSkippedCount ?? 0, changed)}
        </Text>
        <Text style={[font.footnote, { color: theme.secondaryLabel }]}>||site.com^ blocks a site. site.com##.ad hides part of a page. Lines that start with ! are notes.</Text>
        <Pressable accessibilityRole="link" onPress={() => openFromSettings(FILTER_SYNTAX_URL)} style={styles.syntax}>
          <Text style={[font.footnote, styles.bold, { color: theme.formAccent }]}>Filter Syntax</Text>
        </Pressable>
      </View>
    </SettingsPage>
  );
}

export function TrustedSitesPage() {
  const theme = useTheme();
  const hosts = useBlocking((s) => s.state?.exemptHosts ?? []);
  return (
    <SettingsPage title="Trusted Sites" onBack={popSettings}>
      {hosts.length === 0 ? (
        <EmptyState title="No Trusted Sites" message="Sites you allow from the page menu show up here." icon="checkmarkShield" />
      ) : (
        <Group>
          {hosts.map((host, index) => (
            <View key={host}>
              <View style={styles.listRow}>
                <Text style={[font.body, styles.fill, { color: theme.label }]}>{host}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${host}`} onPress={() => trustSite(host, false)} style={styles.remove}>
                  <Symbol name="xmarkCircleFill" size={20} color={theme.destructive} />
                </Pressable>
              </View>
              {index < hosts.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Group>
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  syntax: { alignSelf: "flex-start", paddingVertical: space.xs },
  hero: { alignItems: "center", gap: space.xs, paddingHorizontal: space.l },
  bold: { fontWeight: "600" },
  fill: { flex: 1 },
  listRow: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: settingsLayout.rowMinHeight, paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.s },
  field: { minHeight: dialogLayout.fieldHeight, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.row, paddingHorizontal: space.m },
  editor: { marginHorizontal: space.l, borderRadius: settingsLayout.groupRadius, padding: space.l, minHeight: 240 },
  editorText: { flex: 1, textAlignVertical: "top", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  footer: { paddingHorizontal: space.l + settingsLayout.rowInset, gap: space.xs },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
