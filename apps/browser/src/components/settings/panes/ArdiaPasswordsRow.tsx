import { useState } from "react";
import { orWarn } from "../../../lib/fallback";
import { confirm, showMenu } from "../../../state/app/system";
import { useSettings } from "../../../state/browser/hooks";
import { plural } from "../../../state/browser/model";
import { passwordAutofill, setPasswordAutofillFor } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";
import { exportPasswords, type PasswordExportStatus } from "../../../state/site/passwords";
import { importPasswordsCsv } from "../../../state/site/savedPasswords";
import { EXPORT_FAILED, exportQuestion } from "../../../state/vaults/export";
import { Box, Button, Toggle } from "../../ui";
import { BrandBadge } from "../../vaults/VaultParts";
import { VAULT_SETTINGS } from "../../vaults/tokens";
import { Row } from "../Form";

const ARDIA = "Ardia";

export function ArdiaPasswordsRow({ profile, onImported }: { profile: string; onImported: () => void }) {
  const [autofill = true] = useResource(passwordAutofill, profile);
  const advanced = useSettings((s) => s.showAdvancedSettings);
  const [status, setStatus] = useState("");

  const importCsv = async () => {
    try {
      const result = await importPasswordsCsv(profile);
      if (result === "cancelled") return;
      const skipped = result.skipped ? ` ${plural(result.skipped, "login")} couldn't be saved.` : "";
      setStatus(`Imported ${plural(result.saved, "password")}.${skipped}`);
      onImported();
    } catch (e) {
      setStatus(`Couldn't import that file: ${(e as Error).message}`);
    }
  };

  const exportCsv = async () => {
    const { confirmed } = await confirm(exportQuestion(ARDIA));
    if (!confirmed) return;
    const { status: outcome, path } = await exportPasswords(profile).catch(orWarn<{ status: PasswordExportStatus; path?: string }>({ status: "writeFailed" }));
    const folder = path ? path.split("/").slice(-2, -1)[0] : "";
    if (outcome === "succeeded") setStatus(`Saved to “${folder}”. Delete the file once you're done with it.`);
    else if (outcome === "writeFailed") setStatus(EXPORT_FAILED);
    else if (outcome === "inProgress") setStatus("An export is already running.");
    else setStatus("");
  };

  const more = async () => {
    const choice = await showMenu([
      { id: "import", title: "Import Passwords…", symbol: "square.and.arrow.down" },
      ...(advanced ? [{ id: "export", title: "Export Passwords…", symbol: "square.and.arrow.up" }] : []),
    ]);
    if (choice === "import") await importCsv();
    if (choice === "export") await exportCsv();
  };

  return (
    <Row
      anchor="passwords.ardia"
      icon={<BrandBadge provider="ardia" box={VAULT_SETTINGS.brandTile} glyph={VAULT_SETTINGS.brandGlyph} solid />}
      description={status || (autofill ? undefined : "Off")}
    >
      <Box row gap="s" center>
        <Button variant="icon" icon="ellipsis.circle" size="l" tooltip="More" onPress={() => void more()} />
        <Toggle value={autofill} onChange={(v) => void setPasswordAutofillFor(profile, v)} />
      </Box>
    </Row>
  );
}
