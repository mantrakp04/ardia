import pathlib
import tempfile
import unittest

from support import compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'


class ExtensionFollowupHelperTests(unittest.TestCase):
    def test_shortcut_book_and_native_messaging_lookup(self):
        with tempfile.TemporaryDirectory(prefix='ardia-extension-followups-') as directory:
            scratch = pathlib.Path(directory)
            for folder in ('first', 'second'):
                (scratch / folder).mkdir()
            (scratch / 'second/com.example.host.json').write_text('{}')
            (scratch / 'first/com.example.both.json').write_text('{}')
            (scratch / 'second/com.example.both.json').write_text('{}')
            (scratch / 'first/com.example.folder.json').mkdir()
            output = compile_and_run(self, 'extension-followups', [
                LINUX / 'ac_linux_extension_shortcuts.cc', LINUX / 'ac_linux_native_messaging.cc',
                FIXTURES / 'extension_followups_scenarios.cc',
            ], args=[str(scratch)])
        self.assertIn('extension follow-up scenarios passed', output)


if __name__ == '__main__':
    unittest.main()
