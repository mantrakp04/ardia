export type PermissionAsk = { id: string; tabId: string | null; origin: string; permissions: string[] };
export type PermissionGate = (request: PermissionAsk, signal: AbortSignal) => "deny" | "ask" | Promise<"deny" | "ask">;

let gate: PermissionGate | null = null;

export const setPermissionGate = (next: PermissionGate | null) => {
  gate = next;
};

export const permissionGate = () => gate;
