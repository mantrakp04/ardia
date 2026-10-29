import type { LivePersistenceIntent, LiveProjection } from "../../browser/src/platform/livePersistence";
import { equalDocumentValue, documentError, type DocumentOperation, type DocumentSnapshot } from "./liveDocumentTypes";

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const value = (v: unknown) => v === undefined ? null : v;

export function captureLiveIntent(before: LiveProjection, after: LiveProjection, snapshot: DocumentSnapshot, intent?: LivePersistenceIntent): DocumentOperation[] {
  const operations: DocumentOperation[] = [];
  const foldersBefore = record(before.folders), foldersAfter = record(after.folders);
  const incarnation = (id: string) => snapshot.incarnations[id] ?? `folder:${id}`;
  for (const id of Object.keys(foldersAfter)) {
    if (!foldersBefore[id]) operations.push({ type: "create", id, incarnation: incarnation(id), value: foldersAfter[id] });
    else for (const field of Object.keys(foldersAfter[id])) {
      if (["id", "kind", "profileId", "createdAt", "after"].includes(field) || equalDocumentValue(foldersBefore[id][field], foldersAfter[id][field])) continue;
      if (field === "filters") {
        for (const filter of ["authored", "reviewRequests"]) if (!equalDocumentValue(foldersBefore[id].filters?.[filter], foldersAfter[id].filters?.[filter])) operations.push({ type: "field", target: "folder", id, incarnation: incarnation(id), field: `filters.${filter}`, expected: value(foldersBefore[id].filters?.[filter]), value: value(foldersAfter[id].filters?.[filter]) });
      } else operations.push({ type: "field", target: "folder", id, incarnation: incarnation(id), field, expected: value(foldersBefore[id][field]), value: value(foldersAfter[id][field]) });
    }
  }
  for (const id of Object.keys(foldersBefore)) if (!foldersAfter[id]) operations.push({ type: "delete", id, incarnation: incarnation(id) });
  for (const target of ["config", "calendar"] as const) {
    const a = record(before[target]), b = record(after[target]);
    for (const field of Object.keys(b)) {
      if (field === "hiddenCalendarIds" || equalDocumentValue(a[field], b[field])) continue;
      operations.push({ type: "field", target, field, expected: value(a[field]), value: value(b[field]) });
    }
  }
  const members = (target: "hiddenCalendarIds" | "dismissedAlerts" | "known" | "unread", a: unknown, b: unknown, id?: string) => {
    const left = new Set<string>(list(a)), right = new Set<string>(list(b));
    for (const member of new Set([...left, ...right])) if (left.has(member) !== right.has(member)) operations.push({ type: "member", target, member, present: right.has(member), ...(id ? { id, incarnation: incarnation(id) } : {}) });
  };
  members("hiddenCalendarIds", record(before.calendar).hiddenCalendarIds, record(after.calendar).hiddenCalendarIds);
  members("dismissedAlerts", before.dismissedAlerts, after.dismissedAlerts);
  for (const target of ["known", "unread"] as const) for (const id of Object.keys(record(after[target]))) if (foldersAfter[id]) members(target, record(before[target])[id], record(after[target])[id], id);
  for (const target of ["items", "hidden", "completed"] as const) {
    for (const id of new Set([...Object.keys(record(before[target])), ...Object.keys(record(after[target]))])) {
      if (!foldersAfter[id]) continue;
      const key = (entry: any) => target === "completed" ? entry.item.id : entry.id;
      const left = new Map(list(record(before[target])[id]).map((entry) => [key(entry), entry]));
      const right = new Map(list(record(after[target])[id]).map((entry) => [key(entry), entry]));
      for (const key of new Set([...left.keys(), ...right.keys()])) if (!equalDocumentValue(left.get(key), right.get(key))) operations.push({ type: "entry", target, id, incarnation: incarnation(id), key, expected: value(left.get(key)), value: value(right.get(key)) });
    }
  }
  for (const [key, target] of [["accounts", "account"], ["meetingGroups", "meetingGroup"], ["expandedStacks", "expandedStack"], ["dismissedNow", "dismissedNow"]] as const) {
    const a = record(before[key]), b = record(after[key]);
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (equalDocumentValue(a[id], b[id])) continue;
      operations.push({ type: "field", target, id, field: "value", expected: value(a[id]), value: value(b[id]) });
    }
  }
  if (intent?.kind === "placement") {
    let order = [...list(before.folderOrder)];
    const desired = list(after.folderOrder);
    for (const placement of intent.placed) {
      if (!foldersAfter[placement.id]) continue;
      const at = order.indexOf(placement.id);
      const index = desired.indexOf(placement.id);
      const afterId = index > 0 ? desired[index - 1] : null;
      const expected = at > 0 ? order[at - 1] : null;
      if (afterId !== expected) {
        operations.push({ type: "place", id: placement.id, incarnation: incarnation(placement.id), after: afterId, expected });
        order = order.filter((id) => id !== placement.id);
        order.splice(afterId === null ? 0 : order.indexOf(afterId) + 1, 0, placement.id);
      }
      if (!equalDocumentValue(foldersBefore[placement.id]?.after, placement.after)) operations.push({ type: "field", target: "folder", id: placement.id, incarnation: incarnation(placement.id), field: "after", expected: value(foldersBefore[placement.id]?.after), value: placement.after });
    }
  }

  if (intent?.kind === "refresh" || intent?.kind === "completion") {
    const fence = intent.fence as { generation: number; owner: string; incarnation?: string } | undefined;
    if (!fence) throw documentError("ERR_DOCUMENT_FENCE", "Refresh requires an active native owner");
    const orders = Object.fromEntries((["items", "hidden", "completed"] as const).map((key) => [key, list(record(after[key])[intent.folderId]).map((entry) => key === "completed" ? entry.item.id : entry.id)]));
    const origin = fence.incarnation ?? incarnation(intent.folderId);
    const scoped = operations.map((operation) => "incarnation" in operation ? { ...operation, incarnation: origin } : operation);
    return [{ type: "refresh", id: intent.folderId, incarnation: origin, generation: fence.generation, owner: fence.owner, operations: scoped, ...(intent.kind === "refresh" ? { orders } : {}) }];
  }
  return operations;
}

export function projectLiveIntent(payload: LiveProjection, operations: DocumentOperation[]): LiveProjection {
  const result = structuredClone(payload) as RecordValue;
  for (const op of operations) {
    if (op.type === "refresh") {
      Object.assign(result, projectLiveIntent(result, op.operations));
      for (const [target, ids] of Object.entries(op.orders ?? {})) {
        const entries = list(record(result[target])[op.id]);
        (result[target] ??= {})[op.id] = ids!.flatMap((id) => entries.filter((entry) => (target === "completed" ? entry.item.id : entry.id) === id));
      }
      continue;
    }
    if (op.type === "create") { (result.folders ??= {})[op.id] = op.value; if (!(result.folderOrder ??= []).includes(op.id)) result.folderOrder.push(op.id); }
    if (op.type === "delete") {
      for (const key of ["folders", "items", "hidden", "completed", "known", "unread", "expandedStacks"]) delete (result[key] ?? {})[op.id];
      result.folderOrder = list(result.folderOrder).filter((id) => id !== op.id);
    }
    if (op.type === "field") {
      const target = op.target === "folder" ? (result.folders ??= {})[op.id!] : op.target === "account" ? result.accounts ??= {} : op.target === "meetingGroup" ? result.meetingGroups ??= {} : op.target === "expandedStack" ? result.expandedStacks ??= {} : result[op.target] ??= {};
      if (!target) continue;
      const key = ["account", "meetingGroup", "expandedStack", "dismissedNow"].includes(op.target) ? op.id! : op.field;
      if (key.startsWith("filters.")) (target.filters ??= {})[key.slice(8)] = op.value;
      else if (op.value === null) delete target[key]; else target[key] = op.value;
    }
    if (op.type === "member") {
      const target = op.target === "hiddenCalendarIds" ? result.calendar ??= {} : op.id ? result[op.target] ??= {} : result;
      const key = op.id ?? op.target;
      target[key] = [...new Set([...list(target[key]).filter((id) => id !== op.member), ...(op.present ? [op.member] : [])])];
    }
    if (op.type === "entry") {
      const target = result[op.target] ??= {};
      target[op.id] = [...list(target[op.id]).filter((entry) => (op.target === "completed" ? entry.item.id : entry.id) !== op.key), ...(op.value === null ? [] : [op.value])];
    }
    if (op.type === "place") {
      const order = list(result.folderOrder).filter((id) => id !== op.id);
      order.splice(op.after === null ? 0 : order.indexOf(op.after) + 1, 0, op.id);
      result.folderOrder = order;
    }
  }
  return result;
}
