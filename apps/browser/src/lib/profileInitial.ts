export function profileInitial(name: string): string {
  return Array.from(name.trim().normalize("NFC"))[0]?.toUpperCase() ?? "?";
}

export function profileMark(profile: { name: string; icon?: string | null }): string {
  return profile.icon || profileInitial(profile.name);
}
