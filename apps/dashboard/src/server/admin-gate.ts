export type Viewer =
  | { state: "signed-out" }
  | { state: "denied"; email: string | null }
  | { state: "allowed"; email: string };

export type GateUser = {
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  clientReadOnlyMetadata: unknown;
};

export function isAdminFlagged(metadata: unknown): boolean {
  return typeof metadata === "object" && metadata !== null && (metadata as Record<string, unknown>).is_admin === true;
}

export function viewerFor(user: GateUser | null): Viewer {
  if (!user) return { state: "signed-out" };
  const email = user.primaryEmail?.trim().toLowerCase() || null;
  if (!email || !user.primaryEmailVerified || !isAdminFlagged(user.clientReadOnlyMetadata)) return { state: "denied", email };
  return { state: "allowed", email };
}
