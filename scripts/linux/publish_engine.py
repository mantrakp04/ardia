#!/usr/bin/env python3
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
CHECKOUT = HERE.parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import runtime_files

TABLE = CHECKOUT / 'packages/ardiacore/prebuilt-engines-linux.tsv'
DEFAULT_REPO = 'mckamyk/ardia'
LOCK_WAIT = '30'
HEX40 = re.compile(r'^[0-9a-f]{40}$')


class PublishError(Exception):
    pass


class LockBusy(PublishError):
    pass


def say(message):
    print(message, file=sys.stderr, flush=True)


def git(*args, cwd=CHECKOUT, env=None, check=True):
    result = subprocess.run(['git', *args], cwd=cwd, env=env, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise PublishError(f'git {" ".join(args)} failed: {result.stderr.strip()}')
    return result


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def utc(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def is_git_checkout(source):
    result = git('rev-parse', '--show-toplevel', cwd=source, check=False)
    return result.returncode == 0 and pathlib.Path(result.stdout.strip()).resolve() == source


def contents_tree(source):
    with tempfile.TemporaryDirectory(prefix='ardia-engine-tree-') as scratch:
        repo = pathlib.Path(scratch) / 'objects.git'
        git('init', '-q', '--bare', str(repo))
        env = dict(os.environ, GIT_INDEX_FILE=str(pathlib.Path(scratch) / 'index'))
        git(f'--git-dir={repo}', f'--work-tree={source}', 'add', '-A', '--', 'engine', cwd=source, env=env)
        return git(f'--git-dir={repo}', 'write-tree', '--prefix=engine/', cwd=source, env=env).stdout.strip()


def engine_identity(source):
    if not (source / 'engine').is_dir():
        raise PublishError(f'{source} has no engine/ directory')
    if is_git_checkout(source):
        if git('status', '--porcelain', '--', 'engine', cwd=source).stdout.strip():
            raise PublishError(f'{source}/engine has uncommitted changes: commit them, rebuild, then publish')
        tree = git('rev-parse', 'HEAD:engine', cwd=source).stdout.strip()
        return tree, git('rev-parse', 'HEAD', cwd=source).stdout.strip()
    tree = contents_tree(source)
    marker = source.parent / (source.name + '.commit')
    if not marker.is_file():
        say(f'warning: {source} is not a git checkout and has no {marker.name}; source_commit is null')
        return tree, None
    commit = marker.read_text().strip()
    known = git('rev-parse', '--verify', '--quiet', f'{commit}^{{commit}}', check=False)
    if known.returncode != 0:
        say(f'warning: {marker} names {commit}, which this checkout does not have; source_commit is null')
        return tree, None
    recorded = git('rev-parse', f'{commit}:engine', check=False).stdout.strip()
    if recorded != tree:
        say(f'warning: {marker} names {commit[:12]}, whose engine/ is {recorded[:12] or "missing"}, not the copied {tree[:12]}; source_commit is null')
        return tree, None
    return tree, known.stdout.strip()


def chromium_version(out, source):
    version_file = out.parent.parent / 'chrome/VERSION'
    if version_file.is_file():
        fields = dict(line.split('=', 1) for line in version_file.read_text().split() if '=' in line)
        if all(key in fields for key in ('MAJOR', 'MINOR', 'BUILD', 'PATCH')):
            return '.'.join(fields[key] for key in ('MAJOR', 'MINOR', 'BUILD', 'PATCH'))
    env = source / 'engine/patches/build/env.sh'
    match = re.search(r'^export CHROMIUM_VERSION=(\S+)$', env.read_text(), re.M) if env.is_file() else None
    if match is None:
        raise PublishError(f'no Chromium version in {version_file} or {env}')
    return match.group(1)


def stage_from_out(out, source, stage):
    engine = stage / runtime_files.ARCHIVE_ROOT
    runtime_files.copy(out, engine)
    (engine / 'manifest.json').unlink(missing_ok=True)
    args_gn = out / 'args.gn'
    if not args_gn.is_file():
        raise PublishError(f'no args.gn in {out}')
    facts = {
        'args_gn_sha256': sha256(args_gn),
        'chromium_version': chromium_version(out, source),
        'built_at': utc((out / 'chrome').stat().st_mtime),
    }
    (stage / 'facts.json').write_text(json.dumps(facts))


def stage_locked(out, source, stage):
    locked = CHECKOUT / 'scripts/agent/locked'
    env = dict(os.environ, AC_LOCK_ROOT=os.environ.get('AC_LOCK_ROOT', '/tmp'))
    command = [str(locked), 'chromium', '--wait', LOCK_WAIT, '--', sys.executable, str(pathlib.Path(__file__).resolve()),
               '--stage-into', str(stage), '--out', str(out), '--source', str(source)]
    result = subprocess.run(command, env=env)
    if result.returncode == 75:
        raise LockBusy('the chromium lock is held (a build is running): publish once it finishes')
    if result.returncode != 0:
        raise PublishError(f'staging from {out} failed (exit {result.returncode})')
    return json.loads((stage / 'facts.json').read_text())


def build_id(path):
    notes = subprocess.run(['readelf', '-n', str(path)], text=True, capture_output=True, check=True).stdout
    match = re.search(r'Build ID:\s*([0-9a-f]+)', notes)
    if match is None:
        raise PublishError(f'{path} has no GNU build id')
    return match.group(1)


def strip(engine):
    for path in runtime_files.strippable(engine):
        mode = path.stat().st_mode
        subprocess.run(['strip', '--strip-unneeded', str(path)], check=True)
        path.chmod(mode)


def write_archive(stage, destination):
    partial = destination.with_name('.' + destination.name + '.partial')
    with partial.open('xb') as handle:
        tar = subprocess.Popen(['tar', '--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-C', str(stage), '-cf', '-', runtime_files.ARCHIVE_ROOT], stdout=subprocess.PIPE)
        xz = subprocess.run(['xz', '-T0', '-6', '-c'], stdin=tar.stdout, stdout=handle)
        tar.stdout.close()
        if tar.wait() != 0 or xz.returncode != 0:
            partial.unlink(missing_ok=True)
            raise PublishError(f'could not write {destination}')
    os.replace(partial, destination)


def gh(*args, check=True):
    result = subprocess.run(['gh', *args], text=True, capture_output=True)
    if check and result.returncode != 0:
        raise PublishError(f'gh {" ".join(args)} failed: {result.stderr.strip()}')
    return result


def upload(repo, tree, source_commit, archive, checksum, row):
    tag = runtime_files.release_tag(tree)
    view = gh('release', 'view', tag, '-R', repo, '--json', 'assets', check=False)
    if view.returncode != 0:
        notes = f'Prebuilt Linux x64 ArdiaCore engine for engine/ tree {tree}, built from {source_commit or "an unrecorded commit"}.'
        say(f'creating the prerelease {tag} in {repo}')
        gh('release', 'create', tag, '-R', repo, '--prerelease', '--title', f'Linux engine {tree[:12]}', '--notes', notes)
        assets = set()
    else:
        assets = {asset['name'] for asset in json.loads(view.stdout).get('assets', [])}
    ours = checksum.read_text().split()[0]
    pending = []
    if archive.name in assets:
        if checksum.name not in assets:
            raise PublishError(f'{tag} already has {archive.name} without its .sha256: check it by hand')
        theirs = gh('release', 'download', tag, '-R', repo, '-p', checksum.name, '-O', '-').stdout.split()
        if not theirs or theirs[0] != ours:
            raise PublishError(f'{tag} already has a different {archive.name}: refusing to replace it')
        say(f'{tag} already has this {archive.name}')
    else:
        if checksum.name in assets:
            raise PublishError(f'{tag} has {checksum.name} but no {archive.name}: check it by hand')
        pending = [str(archive), str(checksum)]
    if pending:
        say(f'uploading {archive.name} to {repo} {tag}')
        gh('release', 'upload', tag, '-R', repo, *pending)
    lines = TABLE.read_text().splitlines() if TABLE.is_file() else []
    rows = [line.split('\t') for line in lines if line.strip()]
    existing = [fields for fields in rows if fields[0] == tree]
    if existing and existing[0] != row.split('\t'):
        raise PublishError(f'{TABLE.name} already lists {tree[:12]} differently: {chr(9).join(existing[0])}')
    if not existing:
        with TABLE.open('a') as handle:
            handle.write(row + '\n')
        say(f'added {tree[:12]} to {TABLE.relative_to(CHECKOUT)}: commit it')


def publish(out, source, dest, repo, do_upload):
    runtime_files.select(out)
    tree, source_commit = engine_identity(source)
    if not HEX40.match(tree):
        raise PublishError(f'unexpected engine tree {tree!r}')
    if dest is None:
        dest = pathlib.Path(tempfile.mkdtemp(prefix='ardia-linux-engine-'))
    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / runtime_files.archive_name(tree)
    checksum = dest / (archive.name + '.sha256')
    for path in (archive, checksum):
        if path.exists():
            raise PublishError(f'refusing to overwrite {path}')
    say(f'engine/ tree {tree} from {source_commit or "an unrecorded commit"}')
    with tempfile.TemporaryDirectory(prefix='ardia-engine-stage-') as scratch:
        stage = pathlib.Path(scratch)
        facts = stage_locked(out, source, stage)
        engine = stage / runtime_files.ARCHIVE_ROOT
        unstripped = (engine / 'chrome').stat().st_size
        strip(engine)
        chrome = engine / 'chrome'
        manifest = {
            'format': runtime_files.MANIFEST_FORMAT,
            'engine_tree': tree,
            'source_commit': source_commit,
            'target_os': runtime_files.TARGET_OS,
            'target_cpu': runtime_files.TARGET_CPU,
            'chromium_version': facts['chromium_version'],
            'args_gn_sha256': facts['args_gn_sha256'],
            'chrome_sha256': sha256(chrome),
            'chrome_build_id': build_id(chrome),
            'built_at': facts['built_at'],
            'packaged_at': utc(datetime.datetime.now(datetime.timezone.utc).timestamp()),
        }
        (engine / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        say(f'chrome {unstripped} bytes, {chrome.stat().st_size} stripped')
        write_archive(stage, archive)
    digest = sha256(archive)
    checksum.write_text(f'{digest}  {archive.name}\n')
    row = f'{tree}\t{runtime_files.release_tag(tree)}\t{digest}'
    say(f'{archive.name}: {archive.stat().st_size} bytes')
    if do_upload:
        upload(repo, tree, source_commit, archive, checksum, row)
    print(archive)
    print(row)


def main():
    parser = argparse.ArgumentParser(prog='publish-engine.sh')
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--dest', type=pathlib.Path)
    parser.add_argument('--repo', default=os.environ.get('ARDIACORE_PREBUILT_REPO') or DEFAULT_REPO)
    parser.add_argument('--upload', action='store_true')
    parser.add_argument('--stage-into', type=pathlib.Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    out, source = args.out.resolve(), args.source.resolve()
    try:
        if args.stage_into is not None:
            stage_from_out(out, source, args.stage_into)
            return
        publish(out, source, args.dest.resolve() if args.dest else None, args.repo, args.upload)
    except (PublishError, ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f'publish-engine.sh: {error}', file=sys.stderr)
        sys.exit(75 if isinstance(error, LockBusy) else 1)


if __name__ == '__main__':
    main()
