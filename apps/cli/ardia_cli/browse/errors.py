POLICY_REFUSAL = "isn't allowed for the ardia command"


class BrowseError(Exception):
    exit_code = 1

    def __init__(self, message: str, data: dict | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.data = data
        self.code = code


class Unreachable(BrowseError):
    exit_code = 2


class ConnectionLost(BrowseError):
    exit_code = 2

    def __init__(self, message: str = "Ardia closed the connection (Stop was pressed, control was turned off, or Ardia quit)"):
        super().__init__(message, code="connection_lost")


class OutcomeUnknown(BrowseError):
    exit_code = 1

    def __init__(self, action: str, why: str):
        super().__init__(f"{why}; the outcome of {action} is unknown, so it wasn't retried", code="outcome_unknown")


class StaleRef(BrowseError):
    def __init__(self, ref: str, why: str):
        super().__init__(f"Stale ref @{ref}: {why}. Run `ardia browse snapshot` again and use the new refs", code="stale_ref")


class Gated(BrowseError):
    def __init__(self, method: str, command: str | None = None, detail: str | None = None):
        what = f"`{command}` needs {method}" if command else f"{method} is needed"
        super().__init__(
            f"{what}, which Ardia's ardia-command policy refuses ({method} {POLICY_REFUSAL}). "
            "It works once the engine's token policy allows it; until then only a plain DevTools test "
            "server (--port) accepts it" + (f" ({detail})" if detail else ""),
            data={"method": method},
            code="policy_refused",
        )
        self.method = method


class CdpError(BrowseError):
    def __init__(self, method: str, message: str):
        super().__init__(f"{method}: {message}")
        self.method = method
        self.cdp_message = message


class CdpTimeout(BrowseError):
    def __init__(self, method: str, seconds: float):
        super().__init__(f"{method} got no answer in {seconds:g}s")
        self.method = method


class Usage(BrowseError):
    pass
