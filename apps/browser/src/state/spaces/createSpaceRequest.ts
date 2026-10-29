import { openSettings } from "../settings/settingsWindows";
import { create } from "zustand";
import { useBrowser } from "../browser/store";

export type CreateSpacePreset = { name?: string; profileId?: string };
export type CreateSpaceRequest = { windowId: string | null; preset: CreateSpacePreset; resolve: (id: string | null) => void };

export const useCreateSpaceRequest = create<{ request: CreateSpaceRequest | null; sheet: CreateSpaceRequest | null }>()(() => ({
  request: null,
  sheet: null,
}));

export function requestCreateSpace(windowId?: string, preset: CreateSpacePreset = {}): Promise<string | null> {
  return new Promise((resolve) => {
    openSettings("spaces");
    useCreateSpaceRequest.setState({ sheet: { windowId: null, preset, resolve } });
  });
}

export function endCreateSpaceRequest(request: CreateSpaceRequest, id: string | null) {
  useCreateSpaceRequest.setState({ request: null });
  request.resolve(id);
}

export function takeCreateSpaceSheet(): CreateSpaceRequest | null {
  const { sheet } = useCreateSpaceRequest.getState();
  if (sheet) useCreateSpaceRequest.setState({ sheet: null });
  return sheet;
}

export function spaceNames(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, 2).join(", ")}, & ${names.length - 2} more`;
}
