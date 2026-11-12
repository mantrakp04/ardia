import json
import os
import re
import signal
import subprocess
import threading
import time
import urllib.request


def sh(args, timeout=30, **kw):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, **kw)


def http(method, url, timeout=10):
    req = urllib.request.Request(url, method=method, data=b"" if method in ("POST", "PUT") else None)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def listener_pids(port):
    out = sh(["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"]).stdout.split()
    return sorted({int(p) for p in out})


def proc_info(pid):
    line = sh(["ps", "-o", "lstart=", "-o", "command=", "-p", str(pid)]).stdout.strip()
    if not line:
        return None
    return {"lstart": line[:24].strip(), "command": line[24:].strip()}


def same_process(record):
    if not record:
        return False
    info = proc_info(record["pid"])
    return bool(info) and info["lstart"] == record["lstart"] and info["command"] == record["command"]


def wait_until(test, seconds, what, pid=None, step=0.5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if pid is not None and not proc_info(pid):
            raise RuntimeError(f"{what}: pid {pid} exited")
        try:
            value = test()
            if value:
                return value
        except Exception:
            pass
        time.sleep(step)
    raise RuntimeError(f"{what}: not ready within {seconds} s")


def terminate(record, grace=30):
    if not same_process(record):
        return False
    os.kill(record["pid"], signal.SIGTERM)
    end = time.monotonic() + grace
    while time.monotonic() < end and same_process(record):
        time.sleep(0.3)
    if same_process(record):
        os.kill(record["pid"], signal.SIGKILL)
        end = time.monotonic() + 10
        while time.monotonic() < end and same_process(record):
            time.sleep(0.3)
    return not same_process(record)


def kill_group(proc, grace=10):
    for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, 5)):
        try:
            os.killpg(proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            return
        try:
            proc.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


def kill_on_failure(proc, wait):
    try:
        return wait()
    except BaseException:
        kill_group(proc, grace=3)
        raise


def front_pid():
    asn = sh(["lsappinfo", "front"]).stdout.strip()
    if not asn or "NULL" in asn:
        return None
    m = re.search(r'pid"?\s*=\s*(\d+)', sh(["lsappinfo", "info", "-only", "pid", asn]).stdout)
    return int(m.group(1)) if m else None


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def read_jsonl(path):
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line.startswith("{"):
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out
