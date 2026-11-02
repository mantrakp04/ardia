import { create } from "zustand";

export const useImportBoostSheet = create<{ code: string | null }>()(() => ({ code: null }));

export const showImportBoost = (code: string) => useImportBoostSheet.setState({ code });

export const hideImportBoost = () => useImportBoostSheet.setState({ code: null });
