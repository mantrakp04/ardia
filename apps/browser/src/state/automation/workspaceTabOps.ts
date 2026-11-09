import type { BrowserState } from "../browser/store";
import { inPinnedContainer } from "../browser/model";
import { NO_GROUP_ICON } from "../groups/groupIcons";
import { withSharedFamily } from "../pins/pinShare";
import { splitOf, splitTabIdsOf, withPinnedPanes } from "../splits/splits";
import { isSiteMuted } from "../tabs/mute";
import { needsPage, wokenPage } from "../tabs/pageSession";
import { shownTabIds } from "../tabs/shownTabs";
import { isSleeping } from "../tabs/sleepingTabs";
import { webviews } from "../../platform/webviews";
import type { IconValue, Op } from "./workspaceOps";
import { OpError, store, tabRef, tabRefs, type OpResult } from "./workspaceTargets";

const str = (v: unknown) => v as string;

export function mute(results: OpResult[], op: Op, muted: boolean): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  for (const id of ids) {
    const s = store();
    if (!muted && isSiteMuted(s, s.tabs[id]!)) s.setSiteMuted(id, false);
    if (store().tabs[id]!.muted !== muted) store().setMuted([id], muted);
    if (store().tabs[id]?.muted !== muted) throw new OpError("failed", `Ardia didn't do that: tab ${id} isn't ${muted ? "muted" : "unmuted"}.`);
  }
  return { tabs: ids };
}

function visibleWith(s: BrowserState, id: string): boolean {
  const shown = shownTabIds(s);
  const family = withSharedFamily(s, withPinnedPanes(s, [id]));
  return family.some((x) => shown.has(x) || (splitTabIdsOf(splitOf(s, x)) ?? []).some((pane) => shown.has(pane)));
}

export async function sleep(results: OpResult[], op: Op): Promise<OpResult> {
  const ids = tabRefs(results, op.tabs as string[]);
  const outcomes: Record<string, string> = {};
  for (const id of ids) {
    const s = store();
    if (!s.tabs[id]) outcomes[id] = "gone";
    else if (visibleWith(s, id)) outcomes[id] = "shown";
    else if (inPinnedContainer(s, id)) {
      s.closeTabs([id]);
      outcomes[id] = "asleep";
    } else {
      const view = webviews.get(id);
      const outcome = view ? await view.discard().catch(() => "refused" as const) : "already";
      outcomes[id] = outcome === "discarded" ? "asleep" : outcome;
    }
  }
  return { tabs: ids, outcomes };
}

export async function wake(results: OpResult[], op: Op): Promise<OpResult> {
  const ids = tabRefs(results, op.tabs as string[]);
  const outcomes: Record<string, string> = {};
  for (const id of ids) {
    const t = store().tabs[id];
    if (!t) outcomes[id] = "gone";
    else if (isSleeping(id) && webviews.get(id)) {
      outcomes[id] = await webviews.get(id)!.reload().then(
        () => "awake",
        () => "failed",
      );
    } else if (needsPage(t)) {
      store().updateTab(id, { page: wokenPage(t) });
      outcomes[id] = "awake";
    } else outcomes[id] = "already";
  }
  return { tabs: ids, outcomes };
}

export function closeTabs(results: OpResult[], op: Op): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  store().closeTabs(ids);
  const s = store();
  const left = ids.find((id) => s.tabs[id] && !inPinnedContainer(s, id));
  if (left) throw new OpError("failed", `Ardia didn't do that: tab ${left} is still open.`);
  return { tabs: ids };
}

export function rename(results: OpResult[], op: Op): OpResult {
  const id = tabRef(results, str(op.tab));
  const t = store().tabs[id]!;
  const name = (op.title as string | null) ?? "";
  const customTitle = name && name !== t.title ? name : null;
  store().updateTab(id, { customTitle });
  if (store().tabs[id]?.customTitle !== customTitle) throw new OpError("failed", `Ardia didn't do that: tab ${id} wasn't renamed.`);
  return { tabs: [id] };
}

export function tabIcon(results: OpResult[], op: Op): OpResult {
  const id = tabRef(results, str(op.tab));
  if (op.icon === NO_GROUP_ICON) throw new OpError("bad_request", "\"none\" is for groups; give null to reset a tab's icon.");
  store().updateTab(id, { customIcon: op.icon as IconValue });
  if (store().tabs[id]?.customIcon !== op.icon) throw new OpError("failed", `Ardia didn't do that: tab ${id}'s icon didn't change.`);
  return { tabs: [id] };
}
