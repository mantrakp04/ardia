import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import browsing


class Spaces(unittest.TestCase):
    def test_shared_top_apps_survive_without_windows_and_rows_keep_their_space(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            doc = {
                'version': 4,
                'profiles': {'home': {'name': 'Personal', 'engineId': ''}},
                'spaces': {'school': {'name': 'School', 'profileId': 'home'}, 'projects': {'name': 'Projects', 'profileId': 'home'}},
                'spaceOrder': ['school', 'projects'],
                'topApps': {'home': [{'key': 'mail', 'url': 'https://mail.test', 'title': 'Mail'}]},
                'parkedPins': {'school': {'tabs': [{'id': 'notes', 'url': 'https://notes.test', 'title': 'Notes', 'pinnedAsRow': True}]}},
            }
            (root / 'session.json').write_text(json.dumps(doc))
            with mock.patch.object(browsing, 'checked_root', return_value=root):
                rows = browsing.pinned(root)
            self.assertEqual([(row['title'], row['profile'], row['space']) for row in rows], [('Mail', 'Personal', None), ('Notes', 'Personal', 'School')])
            self.assertTrue(rows[0]['parked'])
            doc['tabs'] = [{'id': 'tile', 'pinKey': 'mail', 'pinned': True, 'spaceId': 'school'}]
            doc['windows'] = [{'tabIds': ['tile']}]
            (root / 'session.json').write_text(json.dumps(doc))
            with mock.patch.object(browsing, 'checked_root', return_value=root):
                rows = browsing.pinned(root)
            self.assertEqual(len(rows), 2)
            self.assertFalse(rows[0]['parked'])
            self.assertEqual(browsing.read_session(root, time.monotonic() + 1)['version'], 4)
