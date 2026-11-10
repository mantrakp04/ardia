import { useMemo } from "react";
import { webviews } from "../../platform/webviews";
import { activeTabId } from "../browser/model";
import { useBrowser, type BrowserState } from "../browser/store";
import { focusedWindowOf } from "../windows/ui";
import { GENERATED_PROVIDER, keptGenerated, useGeneratedPasswords, type VaultGeneratedPassword } from "./generated";
import { useVaultMenus } from "./menu";
import { isSecureOrigin, sameSite } from "./originMatch";
import type { VaultFieldEvent } from "./types";

export type GeneratedFillTarget = { tabId: string; frameId: string; origin: string };
export type GeneratedFillOutcome = "filled" | "declined" | "noField" | "failed";

type SeenFields = Readonly<Record<string, Pick<VaultFieldEvent, "frameId" | "origin"> | null>>;

export function generatedFillTarget(s: BrowserState, fields: SeenFields, origin: string): GeneratedFillTarget | null {
  const windowId = focusedWindowOf(s);
  const tabId = windowId ? activeTabId(s, windowId) : undefined;
  const field = tabId ? fields[tabId] : null;
  if (!tabId || !field || !isSecureOrigin(field.origin) || !sameSite(field.origin, origin)) return null;
  return { tabId, frameId: field.frameId, origin: field.origin };
}

const targetKey = (target: GeneratedFillTarget | null) => (target ? `${target.tabId}\n${target.frameId}\n${target.origin}` : "");

export function useGeneratedFillable(origin: string): boolean {
  const fields = useVaultMenus((s) => s.fields);
  const key = useBrowser((s) => targetKey(generatedFillTarget(s, fields, origin)));
  return !!key;
}

export function useKeptGeneratedPasswords(): VaultGeneratedPassword[] {
  const list = useGeneratedPasswords((s) => s.list);
  const keepDays = useBrowser((s) => s.settings.vaultKeepGenerated);
  return useMemo(() => keptGenerated(list, keepDays, Date.now()), [list, keepDays]);
}

export async function fillGeneratedNow(entry: Pick<VaultGeneratedPassword, "id" | "origin">): Promise<GeneratedFillOutcome> {
  const target = generatedFillTarget(useBrowser.getState(), useVaultMenus.getState().fields, entry.origin);
  const web = target ? webviews.get(target.tabId) : undefined;
  if (!target || !web) return "noField";
  const request = { frameId: target.frameId, origin: target.origin, provider: GENERATED_PROVIDER, id: entry.id, fields: ["username" as const, "password" as const], userChose: false, submit: false };
  const result = await web.fillFromVault(request).catch(() => null);
  if (result?.error === "notAuthorized") return "declined";
  return result?.filled.length ? "filled" : "failed";
}
