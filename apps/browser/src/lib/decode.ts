export type Fields = Record<string, unknown>;

export const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
export const isString = (v: unknown): v is string => typeof v === "string";
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

export const stringOr = <T,>(v: unknown, fallback: T): string | T => (isString(v) ? v : fallback);
export const numberOr = <T,>(v: unknown, fallback: T): number | T => (isNumber(v) ? v : fallback);
export const fieldsOr = <T,>(v: unknown, fallback: T): Fields | T => (isFields(v) ? v : fallback);
export const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
