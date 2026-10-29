import pathlib
import shutil
import subprocess
import tempfile
import unittest

import chromium_series

PATCH = '''--- a/dir/file.txt
+++ b/dir/file.txt
@@ -1,2 +1,2 @@
 one
-two
+changed
--- a/other.txt
+++ b/other.txt
@@ -1 +1 @@
-left
+touched
'''


class ChromiumSeriesTests(unittest.TestCase):
    def test_partial_apply_changes_files_even_inside_another_git_work_tree(self):
        if shutil.which('git') is None:
            self.skipTest('git is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-series-repo-') as repository:
            subprocess.run(['git', 'init', '-q', repository], check=True)
            work = pathlib.Path(repository) / 'nested/scratch'
            (work / 'dir').mkdir(parents=True)
            (work / 'dir/file.txt').write_text('one\ntwo\n')
            (work / 'other.txt').write_text('left\n')
            patch = pathlib.Path(repository) / 'change.patch'
            patch.write_text(PATCH)
            result = chromium_series.apply_files(patch, ['dir/file.txt'], work)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((work / 'dir/file.txt').read_text(), 'one\nchanged\n')
            self.assertEqual((work / 'other.txt').read_text(), 'left\n')


if __name__ == '__main__':
    unittest.main()
