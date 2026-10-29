import { uuid } from "expo-modules-core";

export const secureRandomHex = (length: number): string => {
  let out = "";
  while (out.length < length) out += uuid.v4().replace(/-/g, "");
  return out.slice(0, length);
};
