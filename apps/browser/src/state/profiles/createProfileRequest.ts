import { create } from "zustand";
import { useBrowser } from "../browser/store";

export type CreateProfilePreset = { name?: string; shareWith?: string };
export type CreateProfileRequest = { windowId: string | null; preset: CreateProfilePreset; resolve: (id: string | null) => void };

export const useCreateProfileRequest = create<{ request: CreateProfileRequest | null; sheet: CreateProfileRequest | null }>()(() => ({
  request: null,
  sheet: null,
}));

export function requestCreateProfile(windowId?: string, preset: CreateProfilePreset = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (windowId && useBrowser.getState().windows[windowId]) {
      useCreateProfileRequest.getState().request?.resolve(null);
      useCreateProfileRequest.setState({ request: { windowId, preset, resolve } });
      return;
    }
    useCreateProfileRequest.setState({ sheet: { windowId: null, preset, resolve } });
  });
}

export function endCreateProfileRequest(request: CreateProfileRequest, id: string | null) {
  useCreateProfileRequest.setState({ request: null });
  request.resolve(id);
}

export function takeCreateProfileSheet(): CreateProfileRequest | null {
  const { sheet } = useCreateProfileRequest.getState();
  if (sheet) useCreateProfileRequest.setState({ sheet: null });
  return sheet;
}

export function profileNames(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, 2).join(", ")}, & ${names.length - 2} more`;
}
