import contextlib
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
PATCHES = REPO / 'engine/patches'
TREE = pathlib.Path(os.environ.get('ARDIA_CHROMIUM_156_SRC', pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'))
BASE = pathlib.Path(os.environ.get('AC_SERIES_BASE', TREE.parent.parent.parent / 'series-base-linux-x64'))


def linux_patches():
    names = []
    for raw in (PATCHES / 'series').read_text().splitlines():
        fields = raw.split('#', 1)[0].split()
        if len(fields) >= 2 and fields[0] == 'chromium' and (fields[2] if len(fields) > 2 else 'all') in ('all', 'linux'):
            names.append(fields[1])
    return names


def touched(name):
    return set(re.findall(r'(?m)^\+\+\+ (?:b/)?(\S+)', (PATCHES / name).read_text(errors='surrogateescape')))


def pristine(relative):
    if (BASE / relative).is_file():
        return (BASE / relative).read_bytes()
    if not (TREE / '.git').exists() or shutil.which('git') is None:
        return None
    result = subprocess.run(['git', '-C', str(TREE), 'show', f'HEAD:{relative}'], capture_output=True)
    return result.stdout if result.returncode == 0 else None


def apply_files(patch, files, directory):
    environment = dict(os.environ, GIT_CEILING_DIRECTORIES=str(pathlib.Path(directory).resolve().parent))
    return subprocess.run(['git', 'apply', '--whitespace=nowarn', *(f'--include={f}' for f in files), str(patch)],
                          cwd=directory, env=environment, capture_output=True, text=True)


def materialize_before(name, relatives, directory):
    patches = linux_patches()
    if name not in patches:
        raise AssertionError(f'{name} is not a Linux step of engine/patches/series')
    sources = {relative: pristine(relative) for relative in relatives}
    missing = [relative for relative, text in sources.items() if text is None]
    if missing:
        raise unittest.SkipTest(f'Chromium 156 source is unavailable: {", ".join(missing)}')
    for relative, text in sources.items():
        target = pathlib.Path(directory) / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text)
    for earlier in patches[:patches.index(name)]:
        files = sorted(touched(earlier) & set(relatives))
        if not files:
            continue
        result = apply_files(PATCHES / earlier, files, directory)
        if result.returncode != 0:
            raise AssertionError(f'{earlier}, earlier in the series, does not apply: {result.stderr}')


@contextlib.contextmanager
def applied(name, *relatives):
    if shutil.which('patch') is None or shutil.which('git') is None:
        raise unittest.SkipTest('GNU patch or git is unavailable')
    with tempfile.TemporaryDirectory(prefix='ardia-series-') as directory:
        materialize_before(name, relatives, directory)
        result = subprocess.run(['patch', '-p1', '-F0', '-i', str(PATCHES / name)], cwd=directory, capture_output=True, text=True)
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)
        yield pathlib.Path(directory)
