import asyncio
import json
import os
import signal

OUTPUT_LIMIT = 64 * 1024
MAX_RUNNING = 16
MAX_PER_HOOK = 4
MARGIN = 0.02
MAX_DEADLINE = 5.0


def decide_env(message: dict, base=None) -> dict:
    env = dict(os.environ if base is None else base)
    for variable in ("ARDIA_EVENT", "ARDIA_WINDOW_ID", "ARDIA_TAB_ID", "ARDIA_PROFILE", "ARDIA_URL", "ARDIA_TITLE"):
        env.pop(variable, None)
    env["ARDIA_EVENT"] = str(message.get("event", ""))
    return env


def minimized_url(url: str) -> str:
    cuts = [i for i in (url.find("?"), url.find("#")) if i >= 0]
    return url[: min(cuts)] if cuts else url


def parse_answer(output: bytes):
    text = output.decode("utf-8", "replace").strip()
    if not text:
        return None
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, (dict, list)) or value is None else None


class Decider:
    def __init__(self, log, max_running: int = MAX_RUNNING, per_hook: int = MAX_PER_HOOK):
        self.log = log
        self.max_running = max_running
        self.per_hook = per_hook
        self.running: dict[str, tuple] = {}
        self.answered = 0
        self.skipped = 0

    def busy(self, hook_name: str) -> bool:
        if len(self.running) >= self.max_running:
            return True
        return sum(1 for name, _ in self.running.values() if name == hook_name) >= self.per_hook

    def handle(self, message: dict, accepted: dict, connection) -> None:
        ident = message.get("decide")
        if message.get("cancel") is True:
            self.cancel(ident)
            return
        entry = accepted.get(message.get("hook"))
        if entry is None or ident in self.running:
            return
        revision, hook = entry
        if revision != message.get("revision"):
            self.log.write(f"warning: hook {hook.name}: Ardia asked for a revision this runner didn't register; it uses its default")
            return
        if not hook.served:
            return
        if self.busy(hook.name):
            self.skipped += 1
            self.log.write(f"warning: hook {hook.name}: too many decisions at once; Ardia uses its default for this one")
            return
        task = asyncio.ensure_future(self._run(ident, hook, message, connection))
        self.running[ident] = (hook.name, task)
        task.add_done_callback(lambda _t, i=ident: self.running.pop(i, None))

    def cancel(self, ident) -> None:
        entry = self.running.pop(ident, None)
        if entry is not None:
            entry[1].cancel()

    async def _run(self, ident: str, hook, message: dict, connection) -> None:
        from ardia_cli.hooks import program_argv

        deadline = message.get("deadline")
        seconds = min(max(float(deadline) / 1000 if isinstance(deadline, (int, float)) and not isinstance(deadline, bool) else 0.25, 0.05), MAX_DEADLINE)
        data = message.get("data")
        if not hook.full_urls and isinstance(data, dict) and isinstance(data.get("url"), str):
            data = {**data, "url": minimized_url(data["url"])}
        payload = json.dumps({"decide": ident, "event": message.get("event"), "deadline": deadline, "data": data}, ensure_ascii=False).encode("utf-8") + b"\n"
        argv = program_argv(hook.program)
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=decide_env(message),
                start_new_session=True,
            )
        except (OSError, ValueError) as error:
            self.log.write(f"hook {hook.name}: can't run {argv[0]}: {getattr(error, 'strerror', None) or error}")
            return
        try:
            output = await asyncio.wait_for(self._exchange(process, payload), max(seconds - MARGIN, 0.01))
        except asyncio.TimeoutError:
            self._kill(process)
            self.log.write(f"hook {hook.name}: no answer in {seconds * 1000:.0f} ms; Ardia used its default")
            return
        except asyncio.CancelledError:
            self._kill(process)
            raise
        answer = parse_answer(output)
        if answer is None and output.strip():
            self.log.write(f"hook {hook.name}: the answer isn't a JSON object or list; Ardia used its default")
        if await connection.answer(ident, answer):
            self.answered += 1

    async def _exchange(self, process, payload: bytes) -> bytes:
        try:
            process.stdin.write(payload)
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            try:
                process.stdin.close()
            except Exception:
                pass
        output = b""
        while len(output) <= OUTPUT_LIMIT:
            chunk = await process.stdout.read(65536)
            if not chunk:
                break
            output += chunk
        if len(output) > OUTPUT_LIMIT:
            self._kill(process)
            return b""
        await process.wait()
        return output

    @staticmethod
    def _kill(process) -> None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                process.kill()
            except ProcessLookupError:
                pass
        if process.returncode is None:
            asyncio.ensure_future(process.wait())

    async def stop(self) -> None:
        tasks = [task for _, task in self.running.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.running.clear()
