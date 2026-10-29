#!/usr/bin/env python3
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[4]
LINUX = REPO / 'scripts/linux'
MAC_FETCH = 'packages/ardiacore/scripts/fetch-engine.sh'
DISPATCH = '''if [ "${1:-}" = --arch ]; then
  case "${2:-}" in
    linux-x86_64) shift 2; exec "$root/scripts/linux/fetch-engine.sh" "$@" ;;
    *) die "usage: fetch-engine.sh [--nearest] | fetch-engine.sh --arch linux-x86_64 [--nearest]" ;;
  esac
fi

'''
FIXTURE_FILES = ('scripts/linux/fetch-engine.sh', 'scripts/linux/runtime_files.py', 'scripts/linux/publish-engine.sh',
                 'scripts/linux/publish_engine.py', 'scripts/linux/package.py', 'scripts/agent/locked', MAC_FETCH)
GIT_ENV = {'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_AUTHOR_NAME': 'Test', 'GIT_AUTHOR_EMAIL': 'test@example.com',
           'GIT_COMMITTER_NAME': 'Test', 'GIT_COMMITTER_EMAIL': 'test@example.com'}
ELF = pathlib.Path(shutil.which('true') or '/usr/bin/true')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


sys.dont_write_bytecode = True
runtime = module('runtime_files', LINUX / 'runtime_files.py')
packaging = module('packaging', LINUX / 'package.py')


def has_build_id(path):
    if not shutil.which('readelf') or not shutil.which('strip') or not path.is_file():
        return False
    notes = subprocess.run(['readelf', '-n', str(path)], capture_output=True, text=True)
    return 'Build ID' in notes.stdout


def fake_runtime(directory, junk=True, elf=False):
    directory.mkdir(parents=True, exist_ok=True)
    for name in runtime.REQUIRED:
        if name == 'locales':
            (directory / name).mkdir(exist_ok=True)
            (directory / name / 'en-US.pak').write_bytes(b'locale')
            (directory / name / 'en-US.pak.info').write_bytes(b'info')
        else:
            (directory / name).write_bytes(b'runtime')
    for name in ('libEGL.so', 'libGLESv2.so', 'snapshot_blob.bin', 'vk_swiftshader_icd.json', 'libvulkan.so.1'):
        (directory / name).write_bytes(b'optional')
    if elf:
        shutil.copyfile(ELF, directory / 'chrome')
        shutil.copyfile(ELF, directory / 'libEGL.so')
    (directory / 'chrome').chmod(0o755)
    if junk:
        for name in ('libEGL.so.TOC', 'libVkICD_mock_icd.so', 'libVkLayer_khronos_validation.so', 'chrome.debug', 'args.gn', 'build.ninja'):
            (directory / name).write_bytes(b'junk')
        (directory / 'obj').mkdir(exist_ok=True)
    return directory


def run(command, cwd=None, env=None, timeout=120):
    return subprocess.run([str(part) for part in command], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


class Fixture:
    def __init__(self, root):
        self.root = root
        self.repo = root / 'repo'
        self.repo.mkdir()
        self.env = {key: value for key, value in os.environ.items() if not key.startswith(('ARDIACORE_', 'AC_LOCK', 'GIT_'))}
        self.env.update(GIT_ENV)
        self.env['AC_LOCK_ROOT'] = str(root / 'locks')
        (root / 'locks').mkdir()
        for relative in FIXTURE_FILES:
            target = self.repo / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / relative, target)
        (self.repo / 'packages/ardiacore/prebuilt-engines-linux.tsv').write_text('')
        (self.repo / '.gitignore').write_text('apps/browser/build-ardiacore/\n')
        build = self.repo / 'engine/patches/build'
        build.mkdir(parents=True)
        (build / 'env.sh').write_text('export CHROMIUM_VERSION=156.0.1.2\n')
        self.git('init', '-q', '-b', 'main')
        self.commit_engine('one')

    def git(self, *args, cwd=None):
        result = run(['git', *args], cwd=cwd or self.repo, env=self.env)
        if result.returncode != 0:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def commit_engine(self, content):
        (self.repo / 'engine/version.txt').write_text(content + '\n')
        self.git('add', '-A')
        self.git('commit', '-q', '-m', content)
        return self.tree()

    def commit_other(self, content):
        (self.repo / 'other.txt').write_text(content)
        self.git('add', '-A')
        self.git('commit', '-q', '-m', content)

    def tree(self, rev='HEAD'):
        return self.git('rev-parse', f'{rev}:engine')

    @property
    def store(self):
        return self.repo / 'apps/browser/build-ardiacore/prebuilt-linux-x86_64'


class ArchiveMaker:
    def __init__(self, root):
        self.assets = root / 'assets'
        self.table = root / 'table.tsv'
        self.table.write_text('')

    def manifest(self, tree, **overrides):
        manifest = {'format': 1, 'engine_tree': tree, 'source_commit': None, 'target_os': 'linux', 'target_cpu': 'x64'}
        manifest.update(overrides)
        return json.dumps(manifest).encode()

    def publish(self, tree, members=None, manifest=None, sha=None, skip=()):
        tag = runtime.release_tag(tree)
        folder = self.assets / tag
        folder.mkdir(parents=True, exist_ok=True)
        archive = folder / runtime.archive_name(tree)
        with tarfile.open(archive, 'w:xz') as packed:
            def add(name, data=b'', kind=tarfile.REGTYPE, mode=0o644, link=''):
                info = tarfile.TarInfo(name)
                info.type, info.mode, info.linkname = kind, mode, link
                info.size = len(data) if kind == tarfile.REGTYPE else 0
                packed.addfile(info, io.BytesIO(data) if kind == tarfile.REGTYPE else None)
            root = runtime.ARCHIVE_ROOT
            add(root, kind=tarfile.DIRTYPE, mode=0o755)
            for name in runtime.REQUIRED:
                if name in skip:
                    continue
                if name == 'locales':
                    add(f'{root}/locales', kind=tarfile.DIRTYPE, mode=0o755)
                    add(f'{root}/locales/en-US.pak', b'locale')
                else:
                    add(f'{root}/{name}', b'runtime', mode=0o755 if name == 'chrome' else 0o644)
            add(f'{root}/manifest.json', manifest if manifest is not None else self.manifest(tree))
            for member in members or ():
                add(**member)
        digest = sha or hashlib.sha256(archive.read_bytes()).hexdigest()
        with self.table.open('a') as handle:
            handle.write(f'{tree}\t{tag}\t{digest}\n')
        return archive


class RuntimeSelectionTests(unittest.TestCase):
    def test_allowlist_keeps_runtime_files_and_drops_build_files(self):
        with tempfile.TemporaryDirectory() as scratch:
            out = fake_runtime(pathlib.Path(scratch) / 'out')
            names = runtime.select(out)
            self.assertEqual(names[:len(runtime.REQUIRED)], list(runtime.REQUIRED))
            for name in ('libEGL.so', 'libGLESv2.so', 'snapshot_blob.bin', 'vk_swiftshader_icd.json', 'libvulkan.so.1'):
                self.assertIn(name, names)
            for name in ('libEGL.so.TOC', 'libVkICD_mock_icd.so', 'libVkLayer_khronos_validation.so', 'chrome.debug', 'args.gn', 'obj', 'chrome_sandbox', 'manifest.json'):
                self.assertNotIn(name, names)
            copied = pathlib.Path(scratch) / 'copy'
            runtime.copy(out, copied)
            self.assertEqual(sorted(path.name for path in copied.iterdir()), sorted(names))
            self.assertEqual([path.name for path in (copied / 'locales').iterdir()], ['en-US.pak'])
            (out / 'chrome_sandbox').write_bytes(b'sandbox')
            (out / 'manifest.json').write_text('{}')
            self.assertIn('chrome_sandbox', runtime.select(out))
            self.assertIn('manifest.json', runtime.select(out))
            self.assertNotIn(out / 'chrome_sandbox', runtime.strippable(out))

    def test_missing_required_file_fails(self):
        with tempfile.TemporaryDirectory() as scratch:
            out = fake_runtime(pathlib.Path(scratch) / 'out')
            (out / 'resources.pak').unlink()
            with self.assertRaisesRegex(ValueError, 'resources.pak'):
                runtime.select(out)
            with self.assertRaisesRegex(ValueError, 'resources.pak'):
                runtime.copy(out, pathlib.Path(scratch) / 'copy')
            with self.assertRaisesRegex(ValueError, 'resources.pak'):
                packaging.package(out, pathlib.Path(scratch), pathlib.Path(scratch) / 'a.tar.xz')
            (out / 'resources.pak').write_bytes(b'runtime')
            (out / 'chrome').chmod(0o644)
            with self.assertRaisesRegex(ValueError, 'executable'):
                runtime.select(out)

    def test_package_accepts_a_fetched_engine_dir(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            engine = fake_runtime(root / 'engine', junk=False)
            (engine / 'manifest.json').write_text('{"format": 1}')
            (engine / '.complete').write_text('x\n')
            ui = root / 'ui'
            ui.mkdir()
            (ui / 'index.html').write_text('<html></html>')
            archive = packaging.package(engine, ui, root / 'ardia.tar.xz')
            with tarfile.open(archive) as packed:
                names = packed.getnames()
            self.assertIn('ardia/lib/ardia/manifest.json', names)
            self.assertIn('ardia/lib/ardia/chrome', names)
            self.assertIn('ardia/lib/ardia/locales/en-US.pak', names)
            self.assertNotIn('ardia/lib/ardia/.complete', names)
            self.assertFalse([name for name in names if name.endswith(('.TOC', '.info'))])


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('flock') and has_build_id(ELF), 'Linux with flock, strip, readelf and an ELF with a build id')
class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.scratch.name)
        self.fixture = Fixture(self.root)
        src = self.root / 'chromium/src'
        self.out = fake_runtime(src / 'out/Release_GN_linux_x64', elf=True)
        (self.out / 'args.gn').write_text('target_os="linux"\n')
        (src / 'chrome').mkdir()
        (src / 'chrome/VERSION').write_text('MAJOR=156\nMINOR=0\nBUILD=8078\nPATCH=47\n')

    def tearDown(self):
        self.scratch.cleanup()

    def publish(self, source, dest, *extra):
        return run([self.fixture.repo / 'scripts/linux/publish-engine.sh', '--out', self.out, '--source', source, '--dest', dest, *extra], env=self.fixture.env)

    def snapshot(self, directory):
        return {str(path.relative_to(directory)): (path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
                for path in directory.rglob('*') if path.is_file()}

    def test_dry_run_from_a_checkout_packs_the_allowlist_with_a_manifest(self):
        before = self.snapshot(self.out)
        dest = self.root / 'dest'
        result = self.publish(self.fixture.repo, dest)
        self.assertEqual(result.returncode, 0, result.stderr)
        tree, head = self.fixture.tree(), self.fixture.git('rev-parse', 'HEAD')
        archive = dest / f'ArdiaCore-{tree[:12]}-linux-x64.tar.xz'
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.assertEqual(result.stdout.splitlines(), [str(archive), f'{tree}\tengine-{tree[:12]}\t{digest}'])
        self.assertEqual((dest / (archive.name + '.sha256')).read_text(), f'{digest}  {archive.name}\n')
        self.assertEqual(self.snapshot(self.out), before)
        self.assertTrue((self.root / 'locks/ac-chromium.lockf').exists())
        self.assertFalse((self.root / 'locks/ac-chromium.holder').exists())
        self.assertEqual((self.fixture.repo / 'packages/ardiacore/prebuilt-engines-linux.tsv').read_text(), '')
        with tarfile.open(archive) as packed:
            names = packed.getnames()
            self.assertTrue(all(name == 'ardiacore-linux-x64' or name.startswith('ardiacore-linux-x64/') for name in names), names)
            top = sorted(name.split('/')[1] for name in names if name.count('/') == 1)
            self.assertEqual(top, sorted(runtime.select(self.out) + ['manifest.json']))
            self.assertNotIn('ardiacore-linux-x64/locales/en-US.pak.info', names)
            manifest = json.load(packed.extractfile('ardiacore-linux-x64/manifest.json'))
            chrome = packed.extractfile('ardiacore-linux-x64/chrome').read()
            self.assertTrue(packed.getmember('ardiacore-linux-x64/chrome').mode & 0o111)
            self.assertEqual({member.uid for member in packed.getmembers()}, {0})
        self.assertEqual(manifest['format'], 1)
        self.assertEqual(manifest['engine_tree'], tree)
        self.assertEqual(manifest['source_commit'], head)
        self.assertEqual((manifest['target_os'], manifest['target_cpu']), ('linux', 'x64'))
        self.assertEqual(manifest['chromium_version'], '156.0.8078.47')
        self.assertEqual(manifest['args_gn_sha256'], hashlib.sha256(b'target_os="linux"\n').hexdigest())
        self.assertEqual(manifest['chrome_sha256'], hashlib.sha256(chrome).hexdigest())
        self.assertRegex(manifest['chrome_build_id'], r'^[0-9a-f]{16,}$')
        self.assertRegex(manifest['built_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        self.assertRegex(manifest['packaged_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        again = self.publish(self.fixture.repo, dest)
        self.assertNotEqual(again.returncode, 0)
        self.assertIn('refusing to overwrite', again.stderr)

    def test_dirty_checkout_is_refused(self):
        (self.fixture.repo / 'engine/version.txt').write_text('dirty\n')
        result = self.publish(self.fixture.repo, self.root / 'dest')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('uncommitted', result.stderr)
        self.assertFalse((self.root / 'dest').exists() and any((self.root / 'dest').iterdir()))

    def test_plain_copy_uses_its_contents_tree_and_checks_the_commit_file(self):
        first = self.fixture.git('rev-parse', 'HEAD')
        self.fixture.commit_engine('two')
        copy = self.root / 'builder/repo'
        shutil.copytree(self.fixture.repo, copy, ignore=shutil.ignore_patterns('.git'))
        (copy / 'engine/ignored.log').write_text('ignored')
        for checkout in (copy, self.fixture.repo):
            (checkout / 'engine/.gitignore').write_text('*.log\n')
        self.fixture.git('add', '-A')
        self.fixture.git('commit', '-q', '-m', 'ignore logs')
        tree = self.fixture.tree()
        head = self.fixture.git('rev-parse', 'HEAD')
        marker = self.root / 'builder/repo.commit'
        cases = [(head, head, ''), (first, None, 'source_commit is null'), ('0' * 40, None, 'source_commit is null')]
        for index, (commit, expected, warning) in enumerate(cases):
            marker.write_text(commit + '\n')
            result = self.publish(copy, self.root / f'dest{index}')
            self.assertEqual(result.returncode, 0, result.stderr)
            with tarfile.open(result.stdout.splitlines()[0]) as packed:
                manifest = json.load(packed.extractfile('ardiacore-linux-x64/manifest.json'))
            self.assertEqual(manifest['engine_tree'], tree)
            self.assertEqual(manifest['source_commit'], expected)
            self.assertIn(warning, result.stderr)
        (copy / 'engine/version.txt').write_text('changed\n')
        marker.write_text(head + '\n')
        result = self.publish(copy, self.root / 'dest-changed')
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(result.stdout.splitlines()[0]) as packed:
            manifest = json.load(packed.extractfile('ardiacore-linux-x64/manifest.json'))
        self.assertNotEqual(manifest['engine_tree'], tree)
        self.assertIsNone(manifest['source_commit'])

    def test_help_and_missing_outputs(self):
        usage = run([self.fixture.repo / 'scripts/linux/publish-engine.sh', '--help'], env=self.fixture.env)
        self.assertEqual(usage.returncode, 0)
        self.assertIn('--upload', usage.stdout)
        (self.out / 'icudtl.dat').unlink()
        result = self.publish(self.fixture.repo, self.root / 'dest')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('icudtl.dat', result.stderr)


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('sha256sum') and shutil.which('curl'), 'Linux with sha256sum and curl')
class FetcherTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.scratch.name)
        self.fixture = Fixture(self.root)
        self.assets = ArchiveMaker(self.root)
        self.env = dict(self.fixture.env, ARDIACORE_PREBUILT_ASSETS=self.assets.assets.as_uri(),
                        ARDIACORE_PREBUILT_LINUX_TABLE=str(self.assets.table), ARDIACORE_PREBUILT_TABLE_URL='none')

    def tearDown(self):
        self.scratch.cleanup()

    def fetch(self, *args, script='scripts/linux/fetch-engine.sh'):
        return run([self.fixture.repo / script, *args], env=self.env)

    def assert_fetched(self, result, tree):
        self.assertEqual(result.returncode, 0, result.stderr)
        engine = self.fixture.store / tree[:12]
        self.assertEqual(result.stdout, f'{engine}\n')
        self.assertTrue((engine / '.complete').is_file())
        self.assertEqual(json.loads((engine / 'manifest.json').read_text())['engine_tree'], tree)
        self.assertTrue(os.access(engine / 'chrome', os.X_OK))
        return engine

    def assert_rejected(self, result, tree, message):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertFalse((self.fixture.store / tree[:12]).exists())
        self.assertEqual(list(self.fixture.store.glob('.tmp-*')), [])

    def test_exact_hit_and_cache_reuse_without_network(self):
        tree = self.fixture.tree()
        archive = self.assets.publish(tree)
        engine = self.assert_fetched(self.fetch(), tree)
        archive.unlink()
        again = self.fetch()
        self.assert_fetched(again, tree)
        self.assertIn('cached', again.stderr)
        self.assertEqual(sorted(path.name for path in self.fixture.store.iterdir()), ['.lock', tree[:12]])
        self.assertEqual((engine / '.complete').read_text().strip(), self.assets.table.read_text().split()[2])

    def test_exact_miss_names_the_tree_to_build(self):
        older = self.fixture.tree()
        result = self.fetch()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(older[:12], result.stderr)
        self.assertIn('publish-engine.sh --upload', result.stderr)
        self.assets.publish(older)
        tree = self.fixture.commit_engine('two')
        result = self.fetch()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f'build {tree[:12]}', result.stderr)
        self.assertIn(f'--nearest to use {older[:12]}', result.stderr)
        self.assertEqual(result.stdout, '')

    def test_nearest_selects_the_closest_published_engine_with_a_warning(self):
        oldest = self.fixture.tree()
        self.assets.publish(oldest)
        older = self.fixture.commit_engine('two')
        self.assets.publish(older)
        self.fixture.commit_engine('three')
        tree = self.fixture.commit_engine('four')
        self.fixture.commit_other('docs only')
        result = self.fetch('--nearest')
        self.assert_fetched(result, older)
        self.assertIn(f'no prebuilt Linux engine for engine/ tree {tree[:12]}; using {older[:12]}, 2 engine commits older', result.stderr)
        mac = self.fetch('--arch', 'linux-x86_64', '--nearest', script=MAC_FETCH)
        self.assert_fetched(mac, older)

    def test_checksum_mismatch_is_rejected_before_unpacking(self):
        tree = self.fixture.tree()
        self.assets.publish(tree, sha='0' * 64)
        self.assert_rejected(self.fetch(), tree, 'SHA-256')

    def test_unsafe_members_are_rejected(self):
        root = runtime.ARCHIVE_ROOT
        cases = [
            {'name': '../escape', 'data': b'x'},
            {'name': f'{root}/../../escape', 'data': b'x'},
            {'name': '/tmp/absolute-escape', 'data': b'x'},
            {'name': 'other/file', 'data': b'x'},
            {'name': f'{root}/link', 'kind': tarfile.SYMTYPE, 'link': '/etc/passwd'},
            {'name': f'{root}/locales/link', 'kind': tarfile.SYMTYPE, 'link': '../../outside'},
            {'name': f'{root}/hard', 'kind': tarfile.LNKTYPE, 'link': 'outside/file'},
            {'name': f'{root}/device', 'kind': tarfile.CHRTYPE},
            {'name': f'{root}/fifo', 'kind': tarfile.FIFOTYPE},
        ]
        for index, member in enumerate(cases):
            with self.subTest(member=member['name']):
                tree = self.fixture.commit_engine(f'unsafe {index}')
                self.assets.publish(tree, members=[member])
                self.assert_rejected(self.fetch(), tree, 'isn\'t a valid Linux engine')
                self.assertFalse((self.root / 'escape').exists())
                self.assertFalse(pathlib.Path('/tmp/absolute-escape').exists())

    def test_inside_links_are_allowed(self):
        tree = self.fixture.tree()
        self.assets.publish(tree, members=[{'name': f'{runtime.ARCHIVE_ROOT}/locales/default.pak', 'kind': tarfile.SYMTYPE, 'link': 'en-US.pak'}])
        engine = self.assert_fetched(self.fetch(), tree)
        self.assertEqual((engine / 'locales/default.pak').read_bytes(), b'locale')

    def test_manifest_and_required_files_are_checked(self):
        cases = [({'manifest': self.assets.manifest('f' * 40)}, 'engine_tree'), ({'skip': ('resources.pak',)}, 'resources.pak')]
        for index, (options, message) in enumerate(cases):
            with self.subTest(message=message):
                tree = self.fixture.commit_engine(f'manifest {index}')
                self.assets.publish(tree, **options)
                self.assert_rejected(self.fetch(), tree, message)
        tree = self.fixture.commit_engine('wrong target')
        self.assets.publish(tree, manifest=self.assets.manifest(tree, target_cpu='arm64'))
        self.assert_rejected(self.fetch(), tree, 'target_cpu')

    def test_dirty_engine_is_refused_and_old_engines_are_pruned(self):
        trees = [self.fixture.tree()]
        commits = [self.fixture.git('rev-parse', 'HEAD')]
        for name in ('two', 'three'):
            trees.append(self.fixture.commit_engine(name))
            commits.append(self.fixture.git('rev-parse', 'HEAD'))
        for tree in trees:
            self.assets.publish(tree)
        for commit, tree in zip(commits, trees):
            self.fixture.git('checkout', '-q', commit)
            self.assert_fetched(self.fetch(), tree)
        kept = sorted(path.name for path in self.fixture.store.iterdir() if path.is_dir())
        self.assertEqual(kept, sorted(tree[:12] for tree in trees[1:]))
        (self.fixture.repo / 'engine/version.txt').write_text('dirty\n')
        result = self.fetch()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('uncommitted', result.stderr)

    def test_usage(self):
        self.assertEqual(self.fetch('--help').returncode, 0)
        self.assertNotEqual(self.fetch('--bogus').returncode, 0)
        self.assertNotEqual(self.fetch('--nearest', 'extra').returncode, 0)


class MacDispatchTests(unittest.TestCase):
    def test_only_the_arch_dispatch_was_added(self):
        current = (REPO / MAC_FETCH).read_text()
        self.assertEqual(current.count(DISPATCH), 1)
        committed = subprocess.run(['git', 'show', f'HEAD:{MAC_FETCH}'], cwd=REPO, capture_output=True, text=True, check=True).stdout
        self.assertEqual(current.replace(DISPATCH, ''), committed.replace(DISPATCH, ''))
        self.assertLess(current.index(DISPATCH), current.index('nearest=0\n'))

    def test_unknown_arch_fails_and_mac_usage_is_unchanged(self):
        script = REPO / MAC_FETCH
        bogus = run([script, '--arch', 'bogus'])
        self.assertEqual(bogus.returncode, 1)
        self.assertIn('--arch linux-x86_64', bogus.stderr)
        self.assertNotEqual(run([script, '--arch']).returncode, 0)
        mac = run([script, '--bogus'])
        self.assertEqual((mac.returncode, mac.stderr), (1, 'error: usage: fetch-engine.sh [--nearest]\n'))


class NoCommentTests(unittest.TestCase):
    def test_new_tooling_carries_no_comments(self):
        for relative in ('scripts/linux/runtime_files.py', 'scripts/linux/package.py', 'scripts/linux/publish_engine.py',
                         'scripts/linux/publish-engine.sh', 'scripts/linux/fetch-engine.sh', 'engine/patches/build/tests/test_linux_engine.py'):
            lines = (REPO / relative).read_text().splitlines()
            self.assertTrue(lines[0].startswith('#!'), relative)
            self.assertFalse([line for line in lines[1:] if line.lstrip().startswith('#')], relative)


if __name__ == '__main__':
    unittest.main()
