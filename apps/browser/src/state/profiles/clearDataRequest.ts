import { create } from "zustand";

export const useClearDataRequest = create<{ windowId: string | null }>()(() => ({ windowId: null }));

export const requestClearData = (windowId: string | null) => useClearDataRequest.setState({ windowId });
