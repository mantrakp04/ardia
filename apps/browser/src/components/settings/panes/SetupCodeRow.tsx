import { useState } from "react";
import { applySetupCode, type SetupCodeApplied } from "../../../state/presets/actions";
import { SETUP_CODE_PREFIX } from "../../../state/presets/setupCode";
import { Button, TextField } from "../../ui";
import { Row } from "../Form";

export function SetupCodeRow() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<SetupCodeApplied | null>(null);
  const apply = () => {
    if (!code.trim()) return;
    const applied = applySetupCode(code);
    setResult(applied);
    if (applied.ok) setCode("");
  };
  const description = result ? (result.ok ? `Applied: ${result.lines.join(", ")}.` : result.error) : undefined;
  return (
    <Row anchor="general.setupCode" description={description}>
      <TextField
        value={code}
        onChangeText={(text) => {
          setCode(text);
          setResult(null);
        }}
        placeholder={`${SETUP_CODE_PREFIX}…`}
        onSubmit={apply}
        style={{ width: 170 }}
      />
      <Button title="Apply" disabled={!code.trim()} onPress={apply} />
    </Row>
  );
}
