#!/usr/bin/env python3
import hashlib
import importlib.util
import io
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
VERSION = '0.2.44-nightly.3'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


sys.dont_write_bytecode = True
packaging = module('packaging', LINUX / 'package.py')


def fake_engine(root):
    output, ui = root / 'out', root / 'ui'
    output.mkdir()
    ui.mkdir()
    for name in packaging.REQUIRED:
        if name == 'locales':
            (output / name).mkdir()
            (output / name / 'en-US.pak').write_bytes(b'locale')
        else:
            (output / name).write_bytes(b'runtime')
    (output / 'chrome').chmod(0o755)
    (ui / 'index.html').write_text('<html></html>')
    return output, ui


def fake_cli(directory, version=VERSION, platform='linux-x64', top=None, sidecar=True):
    directory.mkdir(parents=True, exist_ok=True)
    name = f'ardia-cli-{version}-{platform}.tar.gz'
    top = top or f'ardia-cli-{version}'
    tarball = directory / name
    with tarfile.open(tarball, 'w:gz') as packed:
        for member, body in ((f'{top}/bin/ardia', b'#!/bin/sh\necho ardia\n'), (f'{top}/python/README', b'python')):
            info = tarfile.TarInfo(member)
            info.size = len(body)
            info.mode = 0o755
            packed.addfile(info, io.BytesIO(body))
    if sidecar:
        digest = hashlib.sha256(tarball.read_bytes()).hexdigest()
        (directory / (name + '.sha256')).write_text(f'{digest}  {name}\n')
    return tarball


class PackageVersionAndCliTests(unittest.TestCase):
    def test_release_package_carries_version_cli_installer_and_digest(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            output, ui = fake_engine(root)
            tarball = fake_cli(root / 'cli')
            archive = packaging.package(output, ui, root / 'ardia.tar.xz', version=VERSION, cli=tarball)
            with tarfile.open(archive) as packed:
                version = packed.getmember('ardia/lib/ardia/VERSION')
                self.assertEqual(packed.extractfile(version).read().decode(), VERSION + '\n')
                self.assertEqual(version.mode & 0o777, 0o644)
                installer = packed.getmember('ardia/lib/ardia/cli/ardia-cli-install.sh')
                self.assertEqual(installer.mode & 0o777, 0o755)
                self.assertEqual(packed.extractfile(installer).read(), (REPO / 'apps/cli/install.sh').read_bytes())
                shipped = packed.getmember(f'ardia/lib/ardia/cli/{tarball.name}')
                self.assertEqual(shipped.mode & 0o777, 0o644)
                self.assertEqual(packed.extractfile(shipped).read(), tarball.read_bytes())
                digest = packed.extractfile('ardia/lib/ardia/cli/ardia-cli.sha256').read().decode().split()
                self.assertEqual(digest, [hashlib.sha256(tarball.read_bytes()).hexdigest(), tarball.name])
                self.assertEqual(packed.getmember('ardia/lib/ardia/cli').mode & 0o777, 0o755)

    def test_dev_package_has_neither_version_nor_cli(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            output, ui = fake_engine(root)
            archive = packaging.package(output, ui, root / 'dev.tar.xz')
            with tarfile.open(archive) as packed:
                names = packed.getnames()
            self.assertNotIn('ardia/lib/ardia/VERSION', names)
            self.assertFalse(any(name.startswith('ardia/lib/ardia/cli') for name in names))
            archive = packaging.package(output, ui, root / 'versioned.tar.xz', version='1.2.3')
            with tarfile.open(archive) as packed:
                self.assertEqual(packed.extractfile('ardia/lib/ardia/VERSION').read(), b'1.2.3\n')
                self.assertFalse(any(name.startswith('ardia/lib/ardia/cli') for name in packed.getnames()))

    def test_versions_follow_the_contract(self):
        for good in ('0.2.44', '0.2.44-nightly.3', '10.20.30-rc.1'):
            self.assertEqual(packaging.check_version(good), good)
        for bad in ('0.2', 'v0.2.44', '0.2.44-nightly', '0.2.44-Nightly.1', '0.2.44-nightly.1.2', '0.2.44\n', '', None):
            with self.assertRaises(ValueError):
                packaging.check_version(bad)

    def test_cli_tarball_must_match_version_platform_digest_and_layout(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            output, ui = fake_engine(root)
            cases = {
                'other version': (fake_cli(root / 'a', version='0.2.43'), 'not ardia-cli-0.2.44-nightly.3-linux-x64'),
                'mac tarball': (fake_cli(root / 'b', platform='macos-arm64'), 'linux-x64'),
                'stray top': (fake_cli(root / 'c', top='other'), 'outside ardia-cli-0.2.44-nightly.3/'),
            }
            for label, (tarball, message) in cases.items():
                with self.subTest(label), self.assertRaisesRegex(ValueError, message):
                    packaging.package(output, ui, root / f'{label}.tar.xz', version=VERSION, cli=tarball)
            with self.assertRaisesRegex(ValueError, 'needs --version'):
                packaging.package(output, ui, root / 'unversioned.tar.xz', cli=fake_cli(root / 'd'))
            tampered = fake_cli(root / 'e')
            (root / 'e' / (tampered.name + '.sha256')).write_text('0' * 64 + '  ' + tampered.name + '\n')
            with self.assertRaisesRegex(ValueError, 'says'):
                packaging.package(output, ui, root / 'tampered.tar.xz', version=VERSION, cli=tampered)
            unchecked = fake_cli(root / 'f', sidecar=False)
            self.assertTrue(packaging.package(output, ui, root / 'unchecked.tar.xz', version=VERSION, cli=unchecked).is_file())
            self.assertFalse((root / 'other version.tar.xz').exists())

    def test_command_line_requires_version_with_cli(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            output, ui = fake_engine(root)
            tarball = fake_cli(root / 'cli')
            base = [sys.executable, '-I', str(LINUX / 'package.py'), '--out', str(output), '--ui', str(ui)]
            refused = subprocess.run(base + ['--destination', str(root / 'a.tar.xz'), '--cli', str(tarball)], capture_output=True, text=True, timeout=60)
            self.assertEqual(refused.returncode, 2)
            self.assertIn('--cli needs --version', refused.stderr)
            bad = subprocess.run(base + ['--destination', str(root / 'b.tar.xz'), '--version', '1.2'], capture_output=True, text=True, timeout=60)
            self.assertEqual(bad.returncode, 2)
            self.assertIn('bad version', bad.stderr)
            made = subprocess.run(base + ['--destination', str(root / 'c.tar.xz'), '--version', VERSION, '--cli', str(tarball)], capture_output=True, text=True, timeout=120)
            self.assertEqual(made.returncode, 0, made.stderr)
            self.assertTrue((root / 'c.tar.xz').is_file())

    def test_system_install_carries_version_and_cli(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            output, ui = fake_engine(root)
            tarball = fake_cli(root / 'cli')
            archive = packaging.package(output, ui, root / 'ardia.tar.xz', version=VERSION, cli=tarball)
            with tarfile.open(archive) as packed:
                packed.extractall(root / 'extracted', filter='tar')
            result = subprocess.run([str(root / 'extracted/ardia/install.sh'), '--prefix', '/opt/ardia', '--destdir', str(root / 'stage')],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            installed = root / 'stage/opt/ardia/lib/ardia'
            self.assertEqual((installed / 'VERSION').read_text(), VERSION + '\n')
            self.assertEqual((installed / 'cli/ardia-cli-install.sh').stat().st_mode & 0o777, 0o755)
            self.assertEqual((installed / f'cli/{tarball.name}').read_bytes(), tarball.read_bytes())
            self.assertTrue((installed / 'cli/ardia-cli.sha256').is_file())


class ArchPackageTests(unittest.TestCase):
    def pkgver(self, srcdir):
        script = f'source {str(LINUX / "arch/PKGBUILD")!r}; srcdir={str(srcdir)!r}; pkgver'
        result = subprocess.run(['bash', '-c', script], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_pkgver_comes_from_the_package_version(self):
        with tempfile.TemporaryDirectory() as scratch:
            srcdir = pathlib.Path(scratch)
            self.assertEqual(self.pkgver(srcdir), '0.0.0')
            (srcdir / 'ardia/lib/ardia').mkdir(parents=True)
            (srcdir / 'ardia/lib/ardia/VERSION').write_text(VERSION + '\n')
            self.assertEqual(self.pkgver(srcdir), '0.2.44_nightly.3')
            (srcdir / 'ardia/lib/ardia/VERSION').write_text('0.2.45\n')
            self.assertEqual(self.pkgver(srcdir), '0.2.45')


class ReleaseScriptTests(unittest.TestCase):
    def run_release(self, *args):
        return subprocess.run(['bash', str(LINUX / 'release.sh'), *args], capture_output=True, text=True, timeout=60, cwd=REPO)

    def test_help_and_argument_errors(self):
        usage = self.run_release('--help')
        self.assertEqual(usage.returncode, 0)
        for text in ('--engine exact', '--allow-dirty', 'gh release upload', 'dist/<version>/linux'):
            self.assertIn(text, usage.stdout)
        self.assertEqual(self.run_release().returncode, 64)
        self.assertEqual(self.run_release('0.2.44', '--bogus').returncode, 64)
        self.assertIn('neither a stable', self.run_release('0.2.44-rc.1').stderr)
        self.assertIn('MARKETING_VERSION', self.run_release('99.0.0').stderr)
        self.assertIn('needs exact, nearest or a directory', self.run_release('99.0.0', '--engine').stderr)

    def test_script_is_valid_bash_without_comments(self):
        source = (LINUX / 'release.sh').read_text()
        self.assertEqual(subprocess.run(['bash', '-n', str(LINUX / 'release.sh')]).returncode, 0)
        lines = [line.strip() for line in source.splitlines()[1:]]
        self.assertFalse([line for line in lines if line.startswith('#')])
        self.assertTrue(os.access(LINUX / 'release.sh', os.X_OK))


if __name__ == '__main__':
    unittest.main()
