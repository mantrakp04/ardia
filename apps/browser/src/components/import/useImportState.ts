import { useRef, useState } from "react";
import { defaultTarget, emptyCounts, type ImportCounts } from "../../state/import/apply";
import type { BrowserSource, ImportedExtension, ImportKind, Status, Step } from "./model";

export type ImportFailure = { kind: ImportKind; profiles: string[] };
export type FoundExtensions = { profileId: string; list: ImportedExtension[]; opened: boolean };

export const NO_EXTENSIONS: FoundExtensions = { profileId: "", list: [], opened: false };

export function useImportState() {
  const [step, setStep] = useState<Step>("loading");
  const [browsers, setBrowsers] = useState<BrowserSource[]>([]);
  const [source, setSource] = useState<BrowserSource | null>(null);
  const [sourceProfiles, setSourceProfiles] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Set<ImportKind>>(new Set());
  const [target, setTarget] = useState(() => defaultTarget());
  const [status, setStatus] = useState<Partial<Record<ImportKind, Status>>>({});
  const [failures, setFailures] = useState<ImportFailure[]>([]);
  const [counts, setCounts] = useState<ImportCounts>(emptyCounts());
  const [preparing, setPreparing] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [fullDiskAccess, setFullDiskAccess] = useState(false);
  const [safariCookies, setSafariCookies] = useState(true);
  const [notes, setNotes] = useState<string[]>([]);
  const [extensions, setExtensions] = useState<FoundExtensions>(NO_EXTENSIONS);
  const abort = useRef<AbortController | null>(null);
  return {
    step,
    setStep,
    browsers,
    setBrowsers,
    source,
    setSource,
    sourceProfiles,
    setSourceProfiles,
    spaces,
    setSpaces,
    kinds,
    setKinds,
    target,
    setTarget,
    status,
    setStatus,
    failures,
    setFailures,
    counts,
    setCounts,
    preparing,
    setPreparing,
    error,
    setError,
    unlocking,
    setUnlocking,
    fullDiskAccess,
    setFullDiskAccess,
    safariCookies,
    setSafariCookies,
    notes,
    setNotes,
    extensions,
    setExtensions,
    abort,
  };
}

export type ImportState = ReturnType<typeof useImportState>;
