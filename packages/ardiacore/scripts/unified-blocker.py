#!/usr/bin/env python3
import fcntl
import json
import os
from pathlib import Path
import time
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / 'packages/ardiacore/vendor/unified-blocker'
PIN = json.loads((ROOT / 'packages/ardiacore/blocker-source.json').read_text())


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()


def build():
    VENDOR.mkdir(parents=True, exist_ok=True)
    with (VENDOR / '.lock').open('w') as lock:
        deadline = time.monotonic() + 600
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise SystemExit('Timed out waiting for the blocker build lock.')
                time.sleep(0.2)
        override = os.environ.get('ARDIA_BLOCKER_SOURCE')
        source = Path(override).resolve() if override else VENDOR / 'source' / PIN['commit']
        if not override and not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='fetch-', dir=source.parent) as scratch:
                checkout = Path(scratch) / 'repo'
                subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', PIN['repository'], str(checkout)], check=True)
                subprocess.run(['git', '-C', str(checkout), 'checkout', '--detach', PIN['commit']], check=True)
                checkout.rename(source)
        if not (source / 'ardia/tools/build.py').is_file():
            raise SystemExit('ARDIA_BLOCKER_SOURCE must point to the Ardia Blocker source repository.')
        if os.environ.get('ARDIA_BLOCKER_DEV') != '1':
            if git(source, 'rev-parse', 'HEAD') != PIN['commit'] or git(source, 'status', '--porcelain'):
                raise SystemExit('Blocker source must match the clean pinned commit. Use ARDIA_BLOCKER_DEV=1 only for development.')
        subprocess.run(['python3', str(source / 'ardia/tools/build.py')], check=True)
        subprocess.run(['rsync', '-a', '--delete', str(source / 'dist/build/ardia-blocker.chromium') + '/', str(VENDOR / 'ext') + '/'], check=True)


if __name__ == '__main__':
    build()
