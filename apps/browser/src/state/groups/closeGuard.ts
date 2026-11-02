type CloseGuard = (windowId: string, groupId: string) => Promise<boolean>;

let guard: CloseGuard = async () => true;

export const guardGroupClose = (check: CloseGuard) => void (guard = check);

export const groupCloseAllowed = (windowId: string, groupId: string) => guard(windowId, groupId);

let kept: (groupId: string) => boolean = () => false;

export const keepGroupsOpen = (check: (groupId: string) => boolean) => void (kept = check);

export const groupKeptOpen = (groupId: string) => kept(groupId);
