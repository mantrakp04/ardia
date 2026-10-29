#!/usr/bin/env python3
import argparse
import importlib.util
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

BUILD = pathlib.Path(__file__).resolve().parents[1]
REPO = BUILD.parents[2]
sys.path.insert(0, str(BUILD))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


target = module('target', BUILD / 'target_config.py')
series = module('series', BUILD.parent / 'series.py')
helium = module('helium', BUILD / '03-helium.py')
packaging = module('packaging', REPO / 'scripts/linux/package.py')


class TargetTests(unittest.TestCase):
    def test_mac_defaults(self):
        config = target.configuration('mac', env={})
        self.assertEqual((config['AC_TARGET_CPU'], config['GN_OUT_CONFIGS'], config['AC_CHROMIUM_TARGET']), ('arm64', 'Release_GN_arm64', 'chrome_framework'))

    def test_linux_architectures_and_reject_traversal(self):
        for cpu in ('x64', 'arm64'):
            config = target.configuration('linux', cpu, {})
            self.assertEqual(config['GN_OUT_CONFIGS'], f'Release_GN_linux_{cpu}')
            self.assertEqual(config['AC_CHROMIUM_TARGET'], 'chrome')
        for value in ('../Release', 'a/b', '..', '/tmp/out', 'out;touch'):
            with self.assertRaises(ValueError):
                target.configuration('linux', 'x64', {'GN_OUT_CONFIGS': value})

    def test_shell_flags(self):
        for platform in ('mac', 'linux'):
            result = subprocess.run(['bash', '-c', 'source "$1/env.sh"; source "$1/gn_defines.sh"; printf "%s\\n" "${_gn_args[@]}"', 'bash', str(BUILD)], env=dict(os.environ, AC_TARGET_OS=platform, AC_TARGET_CPU='x64'), text=True, capture_output=True, check=True)
            self.assertIn('target_cpu="x64"', result.stdout)
            self.assertIn(f'target_os="{platform}"', result.stdout)
            self.assertIn('enable_cdm_host_verification=' + ('false' if platform == 'linux' else 'true'), result.stdout)
            for flag in ('enable_cdm_storage_id', 'enable_rlz'):
                assignments = [line for line in result.stdout.splitlines() if line.startswith(flag + '=')]
                self.assertEqual(assignments, [flag + '=' + ('false' if platform == 'linux' else 'true')])
            self.assertIn('enable_widevine=true', result.stdout)
            self.assertIn('proprietary_codecs=true', result.stdout)
            if platform == 'mac':
                self.assertIn('alternate_cdm_storage_id_key="968b476909da4373b08903c28e859454"', result.stdout)
            self.assertEqual('use_vaapi=true' in result.stdout, platform == 'linux')

    def test_manifest_is_complete_and_keeps_shared_lifetime_fixes(self):
        mac = series.read_series('mac')
        linux = series.read_series('linux')
        self.assertIn('engine/ardiacore', [s.name for s in mac])
        self.assertNotIn('engine/ardiacore', [s.name for s in linux])
        self.assertIn('engine/ardiacore-linux', [s.name for s in linux])
        for name in ('chromium-cef-carryover.patch', 'chromium-window-hosted.patch'):
            self.assertIn(name, [s.name for s in linux])
        paths = [path for step in linux if step.kind == 'chromium' for path, _ in step.paths()]
        self.assertIn('chrome/browser/ui/browser_manager_service.cc', paths)
        self.assertIn('chrome/browser/ui/unload_controller.cc', paths)
        self.assertNotIn('chrome/browser/chrome_resource_bundle_helper.cc', paths)
        self.assertFalse(any('remote_cocoa' in path or path.endswith(('.mm', '_mac.cc')) for path in paths))
    def test_linux_layer_declares_replacement_headers(self):
        paths = series.layer_paths(str(REPO / 'engine/ardiacore-linux'))
        self.assertIn(('ardia/linux', True), paths)
        self.assertIn(('ardia/core/ac_hooks.h', False), paths)
        self.assertIn(('ardia/core/ac_content_hooks.h', False), paths)
        self.assertIn(('ardia/core/ac_launch_switches.h', False), paths)
        self.assertIn(('ardia/core/ac_launch_switches_linux.cc', False), paths)
        self.assertIn(('ardia/core/BUILD.gn', False), paths)

    def test_linux_layer_materializes_launch_target_and_detects_drift(self):
        layer = REPO / 'engine/ardiacore-linux'
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            env = dict(os.environ, CHROMIUM_SRC=str(root))
            def apply(*args):
                return subprocess.run([str(layer / 'apply.sh'), *args], env=env, text=True, capture_output=True)
            result = apply()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for path, directory in series.layer_paths(str(layer)):
                self.assertTrue((root / path).is_dir() if directory else (root / path).is_file(), path)
            self.assertEqual(apply('--check').returncode, 0)
            for path in ('ardia/core/BUILD.gn', 'ardia/core/ac_launch_switches.h', 'ardia/core/ac_launch_switches_linux.cc', 'ardia/linux/ac_linux_launch_config.h'):
                original = (root / path).read_bytes()
                (root / path).write_text('drift\n')
                self.assertNotEqual(apply('--check').returncode, 0, path)
                self.assertEqual(apply().returncode, 0)
                self.assertEqual((root / path).read_bytes(), original)
            self.assertEqual((root / 'ardia/core/ac_launch_switches.h').read_bytes(), (REPO / 'engine/ardiacore/src/ardia/core/ac_launch_switches.h').read_bytes())
            build = (root / 'ardia/core/BUILD.gn').read_text()
            self.assertIn('assert(is_linux)', build)
            self.assertNotIn('frameworks', build)
            self.assertNotIn('//ardia/linux"', build)



class SeriesFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.here = self.repo / 'engine/patches'
        (self.here / 'build').mkdir(parents=True)
        shutil.copy2(BUILD.parent / 'series.py', self.here / 'series.py')
        for name in ('pathguard.py', 'target_config.py'):
            shutil.copy2(BUILD / name, self.here / 'build' / name)
        guard = self.here / 'build/pathguard.py'
        guard.write_text(guard.read_text().replace("return os.path.realpath(os.path.join(pwd.getpwuid(os.getuid()).pw_dir, 'chromium-build'))", f'return {str(self.root / "protected-unused")!r}'))
        game = self.here / 'build/game-resource.sh'
        game.write_text('#!/usr/bin/env bash\nexit 0\n')
        game.chmod(0o755)
        for platform in ('mac', 'linux'):
            patch = self.here / f'{platform}.patch'
            patch.write_text(f'--- a/value\n+++ b/value\n@@ -1 +1 @@\n-base\n+{platform}\n')
            layer = self.repo / f'engine/{platform}'
            (layer / 'src/owned').mkdir(parents=True)
            (layer / 'src/owned/name').write_text(platform)
            script = layer / 'apply.sh'
            script.write_text('''#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in --paths) printf '%s\\n' shared/external.h; exit 0 ;; esac
here=$(cd "$(dirname "$0")" && pwd)
src=$CHROMIUM_SRC
mkdir -p "$src/owned" "$src/shared"
cp "$here/src/owned/name" "$src/owned/name"
cp "$here/../external.h" "$src/shared/external.h"
''')
            script.chmod(0o755)
        (self.repo / 'engine/external.h').write_text('replacement header\n')
        (self.here / 'series').write_text('chromium mac.patch mac\nchromium linux.patch linux\nlayer engine/mac mac\nlayer engine/linux linux\n')
        self.tree = self.root / 'tree'
        self.tree.mkdir()
        (self.tree / 'value').write_text('base\n')
        (self.tree / 'shared').mkdir()
        (self.tree / 'shared/external.h').write_text('original header\n')
        self.base = self.root / 'base'
        self.env = dict(os.environ, CHROMIUM_SRC=str(self.tree), AC_SERIES_BASE=str(self.base), AC_CHROMIUM_BUILD=str(self.root / 'build'))

    def tearDown(self):
        self.temp.cleanup()

    def run_command(self, command, *args, platform='linux', success=True):
        result = subprocess.run([sys.executable, str(self.here / 'series.py'), command, '--platform', platform, '--cpu', 'x64', *map(str, args)], env=self.env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def test_every_command_selects_linux_and_reapplies_cleanly(self):
        files = self.run_command('files')
        self.assertNotIn('mac.patch:', files.stdout)
        self.run_command('capture-base')
        self.assertEqual((self.base / 'value').read_text(), 'base\n')
        self.assertEqual((self.base / 'shared/external.h').read_text(), 'original header\n')
        self.run_command('apply')
        self.run_command('apply')
        self.assertEqual((self.tree / 'value').read_text(), 'linux\n')
        self.assertEqual((self.tree / 'owned/name').read_text(), 'linux')
        self.assertEqual((self.tree / 'shared/external.h').read_text(), 'replacement header\n')
        self.run_command('check')
        (self.tree / 'shared/external.h').write_text('header drift\n')
        self.run_command('check', success=False)
        self.run_command('apply')
        materialized = self.root / 'materialized'
        self.run_command('materialize', '--until', 'linux.patch', materialized)
        self.assertEqual((materialized / 'value').read_text(), 'linux\n')
        self.assertEqual((materialized / 'shared/external.h').read_text(), 'original header\n')
        full = self.root / 'materialized-layer'
        self.run_command('materialize', '--until', 'engine/linux', full)
        self.assertEqual((full / 'shared/external.h').read_text(), 'replacement header\n')
        self.run_command('materialize', '--until', 'mac.patch', self.root / 'inactive', success=False)
        (self.tree / 'value').write_text('drift\n')
        self.run_command('check', success=False)

    def test_mac_selection_and_separate_default_base(self):
        self.run_command('capture-base', platform='mac')
        self.run_command('apply', platform='mac')
        self.run_command('check', platform='mac')
        self.assertEqual((self.tree / 'value').read_text(), 'mac\n')
        env = dict(self.env)
        env.pop('AC_SERIES_BASE')
        result = subprocess.run([sys.executable, str(self.here / 'series.py'), 'check', '--platform', 'linux', '--cpu', 'arm64'], env=env, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('series-base-linux-arm64', result.stderr)

    def test_base_cannot_be_reused_for_another_platform(self):
        self.run_command('capture-base')
        result = self.run_command('capture-base', platform='mac', success=False)
        self.assertIn('use a separate base', result.stderr)

    def test_unknown_selector_is_rejected(self):
        with (self.here / 'series').open('a') as stream:
            stream.write('chromium linux.patch windows\n')
        self.run_command('files', success=False)


class HeliumTests(unittest.TestCase):
    def test_linux_skips_have_no_macos_requirements(self):
        skips = helium.platform_skips('linux')
        self.assertFalse(any('/macos/' in name for name in skips))
        self.assertIn('helium/linux/rename-chrome-binary.patch', skips)
        self.assertIn('helium/linux/change-chromium-branding.patch', skips)
        self.assertIn('helium/macos/change-keychain-name.patch', helium.platform_skips('mac'))

    def test_linux_icon_generation_never_calls_sips(self):
        with mock.patch.object(helium.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name if name in ('sips', 'magick') else None), mock.patch.object(helium.subprocess, 'run', return_value=argparse.Namespace(returncode=0)) as run:
            helium.resize_icon(pathlib.Path('input.png'), pathlib.Path('output.png'), 48, 'linux')
        self.assertEqual(run.call_args.args[0][0], 'magick')

    def test_linux_submodule_pin_matches_shared_pin(self):
        pins = helium.pins()
        self.assertEqual(pins['helium-linux']['helium_chromium_commit'], pins['helium-chromium']['commit'])
        env = dict(re.findall(r'^export (\w+)=(\S+)$', (BUILD / 'env.sh').read_text(), re.M))
        self.assertEqual(pins['chromium']['version'], env['CHROMIUM_VERSION'])
        for section, variable in (('helium-chromium', 'HELIUM_TAG'), ('helium-macos', 'HELIUM_MACOS_TAG'), ('helium-linux', 'HELIUM_LINUX_TAG')):
            self.assertEqual(pins[section]['tag'], env[variable])

    def test_pin_stage_requires_current_tree_and_actual_matching_submodule(self):
        pins = helium.pins()
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            (root / 'chrome').mkdir()
            (root / 'chromium_version.txt').write_text(pins['chromium']['version'])
            (root / 'deps.ini').write_text('')
            version = root / 'chrome/VERSION'
            def write_version(text):
                version.write_text(''.join(f'{key}={value}\n' for key, value in zip(('MAJOR', 'MINOR', 'BUILD', 'PATCH'), text.split('.'))))
            ctx = argparse.Namespace(hc=root, hm=root / 'linux', tree=root, platform='linux', platform_repo='helium-linux')
            def git(repo, *args):
                section = 'helium-chromium' if repo == ctx.hc else 'helium-linux'
                out = pins[section]['commit'] if args == ('rev-parse', 'HEAD') else '160000 commit ' + pins['helium-chromium']['commit'] + '\thelium-chromium' if args[0] == 'ls-tree' else ''
                return argparse.Namespace(stdout=out, returncode=0)
            with mock.patch.object(helium, 'git', side_effect=git), mock.patch.dict(os.environ, CHROMIUM_VERSION=pins['chromium']['version']):
                write_version(pins['chromium']['version'])
                helium.stage_pins(ctx)
                write_version('155.0.8059.84')
                with self.assertRaisesRegex(helium.StageError, 'the tree is Chromium 155'):
                    helium.stage_pins(ctx)
                write_version(pins['chromium']['version'])
                with mock.patch.object(helium, 'git', side_effect=lambda repo, *args: argparse.Namespace(stdout='160000 commit mismatched\thelium-chromium', returncode=0) if args[0] == 'ls-tree' else git(repo, *args)):
                    with self.assertRaisesRegex(helium.StageError, 'submodule does not match'):
                        helium.stage_pins(ctx)


class PackagingTests(unittest.TestCase):
    def test_packaged_ui_sits_beside_binary_and_runtime_files_survive(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
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
            (output / 'libEGL.so').write_bytes(b'library')
            (ui / 'index.html').write_text('<html></html>')
            archive = packaging.package(output, ui, root / 'ardia.tar.xz')
            with tarfile.open(archive) as packed:
                self.assertIn('ardia/lib/ardia/ardia-ui/index.html', packed.getnames())
                self.assertIn('ardia/lib/ardia/libEGL.so', packed.getnames())
                self.assertNotIn('--no-sandbox', packed.extractfile('ardia/bin/ardia').read().decode())
                policy = packed.extractfile('ardia/share/polkit-1/actions/dev.ardia.linux.policy').read().decode()
                self.assertIn('<action id="dev.ardia.linux.reauthenticate">', policy)
                self.assertIn('<allow_active>auth_self</allow_active>', policy)
                self.assertIn('<allow_any>no</allow_any>', policy)
                self.assertNotIn('auth_self_keep', policy)
                self.assertNotIn('<!--', policy)
            with self.assertRaises(ValueError):
                packaging.package(output, ui, archive)

    def test_content_blocker_ships_beside_the_binary_with_its_bridge_page(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            output, ui, ubo = root / 'out', root / 'ui', root / 'ubo'
            output.mkdir()
            ui.mkdir()
            (ubo / 'js').mkdir(parents=True)
            (ubo / '_metadata').mkdir()
            (ubo / '_metadata/verified_contents.json').write_text('{}')
            for name in packaging.REQUIRED:
                if name == 'locales':
                    (output / name).mkdir()
                else:
                    (output / name).write_bytes(b'runtime')
            (output / 'chrome').chmod(0o755)
            (ui / 'index.html').write_text('<html></html>')
            for name in packaging.BRIDGE_SCRIPTS:
                (ubo / name).write_text('')
            (ubo / 'manifest.json').write_text('{"manifest_version": 2, "key": "k", "version": "1.75.0.22"}')
            archive = packaging.package(output, ui, root / 'ardia.tar.xz', ubo)
            with tarfile.open(archive) as packed:
                names = packed.getnames()
                for name in ['manifest.json', 'js/vapi-client.js', 'ardia-linux-bridge.html', 'ardia-linux-bridge.js']:
                    self.assertIn(f'ardia/lib/ardia/extensions/ublock/{name}', names)
                self.assertFalse(any('_metadata' in name for name in names))
                bridge = packed.extractfile('ardia/lib/ardia/extensions/ublock/ardia-linux-bridge.js').read()
                self.assertEqual(bridge, (packaging.BRIDGE / 'ardia-linux-bridge.js').read_bytes())
            (ubo / 'js/vapi-client.js').unlink()
            with self.assertRaisesRegex(ValueError, 'vapi-client'):
                packaging.package(output, ui, root / 'missing.tar.xz', ubo)
            (ubo / 'js/vapi-client.js').write_text('')
            (ubo / 'manifest.json').write_text('{"manifest_version": 3}')
            with self.assertRaisesRegex(ValueError, 'keyed uBlock Origin'):
                packaging.package(output, ui, root / 'unkeyed.tar.xz', ubo)

    def fake_package(self, root):
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
        archive = packaging.package(output, ui, root / 'ardia.tar.xz')
        extracted = root / 'extracted'
        with tarfile.open(archive) as packed:
            self.assertIn('ardia/install.sh', packed.getnames())
            self.assertTrue(packed.getmember('ardia/install.sh').mode & 0o111)
            packed.extractall(extracted, filter='tar')
        return archive, extracted / 'ardia'

    def test_installer_puts_the_polkit_policy_where_polkit_reads_it(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            _, package_root = self.fake_package(root)
            installer = package_root / 'install.sh'
            usage = subprocess.run([str(installer), '--help'], capture_output=True, text=True, timeout=30)
            self.assertEqual(usage.returncode, 0, usage.stderr)
            self.assertIn('/usr/share/polkit-1/actions', usage.stdout)
            for prefix in ['/usr', '/opt/ardia', '/usr/local']:
                destdir = root / ('dest' + prefix.replace('/', '-'))
                result = subprocess.run([str(installer), '--prefix', prefix, '--destdir', str(destdir)],
                                        capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                policy = destdir / 'usr/share/polkit-1/actions/dev.ardia.linux.policy'
                self.assertEqual(policy.read_text(), (REPO / 'scripts/linux/dev.ardia.linux.policy').read_text())
                self.assertEqual(policy.stat().st_mode & 0o777, 0o644)
                installed = destdir / prefix.lstrip('/')
                self.assertTrue((installed / 'lib/ardia/chrome').is_file())
                self.assertTrue(os.access(installed / 'lib/ardia/chrome', os.X_OK))
                self.assertTrue((installed / 'lib/ardia/ardia-ui/index.html').is_file())
                launcher = (installed / 'bin/ardia').read_text()
                self.assertIn(f'exec "{prefix}/lib/ardia/chrome" "$@"', launcher)
                self.assertNotIn(str(destdir), launcher)
                self.assertTrue(os.access(installed / 'bin/ardia', os.X_OK))
                desktop = (installed / 'share/applications/ardia.desktop').read_text()
                self.assertIn(f'Exec={prefix}/bin/ardia %U', desktop)
                self.assertFalse((installed / 'install.sh').exists())
                self.assertFalse((installed / 'share/polkit-1').exists() and prefix != '/usr')
            for bad in ['relative', '/opt/a|b', '/opt/a&b', '/opt/a b']:
                refused = subprocess.run([str(installer), '--prefix', bad, '--destdir', str(root / 'refused')],
                                         capture_output=True, text=True, timeout=30)
                self.assertNotEqual(refused.returncode, 0, bad)
                self.assertFalse((root / 'refused').exists(), bad)

    @unittest.skipUnless(shutil.which('fakeroot'), 'fakeroot is required')
    def test_root_install_owns_every_file_as_root_whoever_unpacked_the_package(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            _, package_root = self.fake_package(root)
            destdir = root / 'dest'
            script = 'set -e; chown -R 1000:1000 "$1"; "$1/install.sh" --prefix /usr --destdir "$2"; find "$2" -printf "%U:%G %p\\n"'
            result = subprocess.run(['fakeroot', 'bash', '-c', script, 'install', str(package_root), str(destdir)],
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            owners = [line for line in result.stdout.splitlines() if line.strip()]
            self.assertTrue(any(line.endswith('/usr/lib/ardia/chrome') for line in owners), owners)
            self.assertEqual([line for line in owners if not line.startswith('0:0 ')], [])

    def test_installer_refuses_parent_segments_and_a_non_root_system_install_up_front(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            _, package_root = self.fake_package(root)
            installer = package_root / 'install.sh'
            for bad in ['/usr/../etc', '/opt/ardia/..', '/../usr']:
                refused = subprocess.run([str(installer), '--prefix', bad, '--destdir', str(root / 'dotdot')],
                                         capture_output=True, text=True, timeout=30)
                self.assertNotEqual(refused.returncode, 0, bad)
                self.assertFalse((root / 'dotdot').exists(), bad)
            if os.geteuid() == 0:
                self.skipTest('the non-root refusal needs a non-root user')
            target = root / 'system'
            refused = subprocess.run([str(installer), '--prefix', str(target)], capture_output=True, text=True, timeout=30)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn('root', refused.stderr)
            self.assertFalse(target.exists())

    def test_arch_package_installs_the_policy_through_the_installer(self):
        pkgbuild = (REPO / 'scripts/linux/arch/PKGBUILD').read_text()
        self.assertIn("'polkit'", pkgbuild)
        self.assertNotRegex(pkgbuild, r'(^|\s)#')
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            _, package_root = self.fake_package(root)
            srcdir, pkgdir = package_root.parent, root / 'pkg'
            pkgdir.mkdir()
            script = f'set -euo pipefail; source "$1"; srcdir="$2"; pkgdir="$3"; cd "$srcdir"; package'
            result = subprocess.run(['bash', '-c', script, 'pkgbuild', str(REPO / 'scripts/linux/arch/PKGBUILD'), str(srcdir), str(pkgdir)],
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue((pkgdir / 'usr/share/polkit-1/actions/dev.ardia.linux.policy').is_file())
            self.assertTrue((pkgdir / 'usr/bin/ardia').is_file())
            self.assertTrue((pkgdir / 'usr/lib/ardia/chrome').is_file())
        if shutil.which('makepkg'):
            with tempfile.TemporaryDirectory() as scratch:
                shutil.copy(REPO / 'scripts/linux/arch/PKGBUILD', scratch)
                info = subprocess.run(['makepkg', '--printsrcinfo'], cwd=scratch, capture_output=True, text=True, timeout=60)
                self.assertEqual(info.returncode, 0, info.stderr)
                self.assertIn('depends = polkit', info.stdout)

    def test_installer_and_pkgbuild_carry_no_comments(self):
        for path in [REPO / 'scripts/linux/install.sh', REPO / 'scripts/linux/arch/PKGBUILD']:
            lines = path.read_text().splitlines()
            self.assertTrue(lines[0].startswith('#!') or path.name == 'PKGBUILD')
            self.assertFalse([line for line in lines[1:] if line.lstrip().startswith('#')], path)


if __name__ == '__main__':
    unittest.main()
