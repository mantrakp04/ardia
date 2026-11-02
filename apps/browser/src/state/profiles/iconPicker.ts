import type { View } from "react-native";
import { create } from "zustand";
import { currentProfile } from "../browser/current";
import { setSwitcherIcon, updateProfile } from "./actions";
import type { ProfileMenuPlace } from "./profileMenu";

export type IconPickerAnchor = { x: number; y: number; width: number; height: number };
export type ProfileIconPicker = { profileId: string; windowId: string; place: ProfileMenuPlace; anchor: IconPickerAnchor | null };

export const useProfileIconPicker = create<{ picker: ProfileIconPicker | null }>()(() => ({ picker: null }));

export function profileIconPickerIn(windowId: string): boolean {
  const picker = useProfileIconPicker.getState().picker;
  return picker?.windowId === windowId && !!currentProfile(picker.profileId);
}

const measure = (view: View | null): Promise<IconPickerAnchor | null> =>
  new Promise((resolve) => (view ? view.measureInWindow((x, y, width, height) => resolve(width ? { x, y, width, height } : null)) : resolve(null)));

export async function openProfileIconPicker(profileId: string, windowId: string, place: ProfileMenuPlace, anchorView: View | null) {
  const anchor = await measure(anchorView);
  if (currentProfile(profileId)) useProfileIconPicker.setState({ picker: { profileId, windowId, place, anchor } });
}

export const closeProfileIconPicker = () => useProfileIconPicker.setState({ picker: null });

export function closeProfileIconPickerIfShown(picker: ProfileIconPicker) {
  if (useProfileIconPicker.getState().picker === picker) closeProfileIconPicker();
}

export function closeProfileIconPickerIn(windowId: string) {
  if (profileIconPickerIn(windowId)) closeProfileIconPicker();
}

export function chooseProfileIcon({ profileId, place }: ProfileIconPicker, icon: string | null) {
  if (place === "sidebar") setSwitcherIcon(profileId, icon);
  else updateProfile(profileId, { icon });
  closeProfileIconPicker();
}
