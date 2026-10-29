import { useEffect, useState } from "react";
import { Group, Row } from "./settingsForm";
import { ardiaHost } from "./host";
import { autofillStatus, credentialNotice, credentialNoticeTitle, credentialStorage, passwordStatus } from "./hostCredentials";

type Shown = { title: string; notice: string | null; storage: string | null };

export function CredentialNotice({ kind }: { kind: "passwords" | "autofill" }) {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    if (!ardiaHost) return;
    let live = true;
    const status = kind === "passwords" ? passwordStatus(ardiaHost) : autofillStatus(ardiaHost);
    status.then(
      (value) => live && setShown({ title: credentialNoticeTitle(value, kind), notice: credentialNotice(value, kind), storage: credentialStorage(value, kind) }),
      (error: unknown) =>
        live &&
        setShown({
          title: kind === "passwords" ? "Passwords are unavailable" : "Some autofill data is unavailable",
          notice: error instanceof Error ? error.message : "Saved data is unavailable on this computer.",
          storage: null,
        }),
    );
    return () => {
      live = false;
    };
  }, [kind]);
  if (!shown || (!shown.notice && !shown.storage)) return null;
  return (
    <Group>
      {shown.notice ? <Row title={shown.title} description={shown.notice} /> : null}
      {shown.storage ? <Row title="Storage on this computer" description={shown.storage} /> : null}
    </Group>
  );
}
