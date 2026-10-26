import { useEffect, useState } from "react";
import { copySetupCode } from "../../browser/src/state/presets/actions";
import { startCustomize, watchCustomize, type CustomizeState } from "./customizeFlow";

export function Customize() {
  const [state, setState] = useState<CustomizeState>({ active: false, code: null });
  const [copied, setCopied] = useState(false);
  useEffect(() => watchCustomize(setState), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="ardia-customize">
      <button type="button" className="ardia-customize-button" disabled={state.active} onMouseDown={(e) => e.preventDefault()} onClick={startCustomize}>
        {state.code ? "Customize again" : "Customize it"}
      </button>
      {state.code ? (
        <>
          <code className="ardia-customize-code">{state.code}</code>
          <button
            type="button"
            className="ardia-customize-copy"
            onClick={() => {
              copySetupCode(state.code!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </>
      ) : null}
    </div>
  );
}
