import { classifyNoise as classifySiteNoise } from "../../../site/src/data/telemetry";

function framesOf(list: string): { filename?: string }[] {
  try {
    const parsed = JSON.parse(list) as { stacktrace?: { frames?: { filename?: string }[] } }[];
    return parsed.flatMap((entry) => entry.stacktrace?.frames ?? []);
  } catch {
    return [];
  }
}

export function classifyNoise(where: string, message: string, list: string, userAgent: string): string | null {
  if (where === "app") return null;
  return classifySiteNoise({ message, frames: framesOf(list), userAgent });
}
