import pathlib
import re
import subprocess
import tempfile
import unittest


PATCHES = pathlib.Path(__file__).resolve().parents[2]
HEADERS = {
    'chrome/browser/helium_flag_choices.h',
    'chrome/browser/helium_flag_entries.h',
}
SAFARI = 'chrome/browser/ui/webui/settings/brave_full_disk_access_confirm_dialog_delegate_mac.mm'


def sections(path):
    text = path.read_text()
    starts = list(re.finditer(r'^--- a/(.+)$', text, re.MULTILINE))
    return {
        match.group(1): text[match.start():starts[index + 1].start() if index + 1 < len(starts) else len(text)]
        for index, match in enumerate(starts)
    }


def original(section):
    lines = {}
    position = None
    for line in section.splitlines():
        header = re.match(r'^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@', line)
        if header:
            position = int(header.group(1))
        elif position is not None and line.startswith((' ', '-')):
            if position in lines and lines[position] != line[1:]:
                raise ValueError('Conflicting original hunk lines')
            lines[position] = line[1:]
            position += 1
    return '\n'.join(lines.get(index, '') for index in range(1, max(lines) + 1)) + '\n'


class BrandingSplitTests(unittest.TestCase):
    def apply_platform(self, platform):
        common = sections(PATCHES / 'chromium-helium-branding.patch')
        selected = sections(PATCHES / f'chromium-helium-branding-{platform}.patch')
        paths = HEADERS | ({SAFARI} if platform == 'mac' else set())
        with tempfile.TemporaryDirectory() as scratch:
            root = pathlib.Path(scratch)
            for path in paths:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(original(selected[path]))
            for name, patch in [('shared', common), (platform, selected)]:
                text = ''.join(part for path, part in patch.items() if path in paths)
                if not text:
                    continue
                result = subprocess.run(
                    ['patch', '-p1', '--batch', '--forward', '--fuzz=0'],
                    input=text, text=True, capture_output=True, cwd=root,
                )
                self.assertEqual(result.returncode, 0, name + ': ' + result.stdout + result.stderr)
            choices = (root / 'chrome/browser/helium_flag_choices.h').read_text()
            entries = (root / 'chrome/browser/helium_flag_entries.h').read_text()
            self.assertIn('kHeliumNoiseCommandLine[] = "ardia-noise";', choices)
            self.assertNotIn('"helium-noise"', choices)
            self.assertIn('"Ardia Noise"', entries)
            self.assertNotIn('{helium::kChannelCommandLine,', entries)
            if platform == 'linux':
                self.assertIn('"ardia-middle-click-paste-enabled"', choices)
                self.assertIn('Controls middle click paste functionality. Ardia flag.', entries)
            else:
                safari = (root / SAFARI).read_text()
                self.assertIn('return std::u16string();', safari)
                self.assertNotIn('https://github.com/imputnet/helium-macos/wiki/Import-data-from-Safari', safari)

    def test_mac_branding_sequence_applies_once_and_keeps_safari_change(self):
        self.apply_platform('mac')

    def test_linux_branding_sequence_applies_once_and_keeps_platform_flags(self):
        self.apply_platform('linux')
