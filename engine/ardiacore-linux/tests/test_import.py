import json
import os
import sqlite3
import unittest

from support import ImportFixture, basic_key, bookmark, encrypt_v10, folder, links, make_history, make_logins, tree_digests, webkit


class FormatTests(ImportFixture):
    def test_units(self):
        self.assertIn('units passed', self.run_binary('units'))
        self.assertEqual(self.run_binary('key').strip(), basic_key().hex())

    def test_nested_bookmark_html_from_chrome_firefox_and_safari_exports(self):
        html = self.root / 'bookmarks.html'
        html.write_text('''<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. <DT><A HREF="https://comment.invalid/">no</A> -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://one.example/?a=1&amp;b=2" ADD_DATE="1700000001">One &amp; &#8364; &#x41;</A>
        <DT><H3>Work</H3>
        <DL><p>
            <DT><A HREF="https://two.example/">Two</A>
            <DT><H3>Deeper</H3>
            <DL><p>
                <DT><A HREF='https://three.example/'>Three</A>
                <DT><A HREF="place:sort=8">Recent</A>
            </DL><p>
        </DL><p>
        <DT><H3>Empty</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><H3 UNFILED_BOOKMARKS_FOLDER="true">Other Bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://four.example/"></A>
        <DT><A>missing href</A>
    </DL><p>
    <DT><A HREF="https://five.example/">Five</A>
</DL><p>
''')
        parsed = self.json('html', html)
        self.assertEqual(parsed['error'], '')
        self.assertEqual(parsed['links'], 5)
        self.assertEqual(parsed['counted'], 5)
        self.assertFalse(parsed['truncated'])
        root = parsed['root']
        self.assertEqual([c['title'] for c in root['children']], ['Bookmarks bar', 'Other Bookmarks', 'Five'])
        toolbar = root['children'][0]
        self.assertEqual(toolbar['role'], 'toolbar')
        self.assertEqual(toolbar['dateAdded'], 1700000000000)
        self.assertEqual(toolbar['children'][0], {'type': 'url', 'title': 'One & € A', 'url': 'https://one.example/?a=1&b=2', 'dateAdded': 1700000001000})
        work = toolbar['children'][1]
        self.assertEqual(work['title'], 'Work')
        self.assertEqual(links(work), ['https://two.example/', 'https://three.example/'])
        self.assertEqual(work['children'][1]['title'], 'Deeper')
        self.assertEqual(toolbar['children'][2], {'type': 'folder', 'title': 'Empty', 'children': []})
        other = root['children'][1]
        self.assertEqual(other['role'], 'other')
        self.assertEqual(other['children'], [{'type': 'url', 'title': 'https://four.example/', 'url': 'https://four.example/'}])

    def test_password_csv_variants_counts_and_deduplication(self):
        chrome = self.root / 'chrome.csv'
        chrome.write_bytes('﻿name,url,username,password,note\r\n'
                           'one,https://one.example/login,alice,pw1,"multi\nline, note"\r\n'
                           'one,https://one.example/login,alice,pw1,\r\n'
                           'one,https://ONE.example/other,alice,pw1,dup by origin\r\n'
                           'two,https://two.example/,bob,"pa""ss,word",\r\n'
                           'nopass,https://three.example/,carol,,\r\n'
                           ',,dave,pw4,\r\n'
                           'bad,javascript:alert(1),eve,pw5,\r\n'
                           'short,https://four.example/\r\n'
                           'host,five.example,frank,pw6,\r\n'.encode())
        parsed = self.json('csv', chrome)
        self.assertEqual(parsed['error'], '')
        self.assertEqual(parsed['rows'], 9)
        self.assertEqual(parsed['invalid'], 4)
        self.assertEqual(parsed['duplicates'], 2)
        rows = parsed['credentials']
        self.assertEqual([(r['url'], r['username'], r['password']) for r in rows], [
            ('https://one.example/login', 'alice', 'pw1'),
            ('https://two.example/', 'bob', 'pa"ss,word'),
            ('https://five.example', 'frank', 'pw6'),
        ])
        self.assertEqual(rows[0]['note'], 'multi\nline, note')

        unsupported = self.root / 'unsupported.csv'
        unsupported.write_text('a,b,c\n1,2,3\n')
        self.assertEqual(self.json('csv', unsupported)['error'], 'unsupported')
        empty = self.root / 'empty.csv'
        empty.write_text('')
        self.assertEqual(self.json('csv', empty)['error'], 'empty')

    def test_profiles_ini_uses_install_defaults_and_marks_absolute_paths(self):
        ini = self.root / 'profiles.ini'
        ini.write_text('[General]\nStartWithLastProfile=1\n\n[Profile1]\nName=old\nIsRelative=1\nPath=abc.default\nDefault=1\n\n'
                       '[Profile0]\nName=main\nIsRelative=1\nPath=xyz.default-release\n\n[Profile2]\nName=abs\nIsRelative=0\nPath=/elsewhere\n\n'
                       '[Install4F96D1932A9F858E]\nDefault=xyz.default-release\nLocked=1\n')
        parsed = self.json('ini', ini)
        self.assertEqual(parsed[0], {'name': 'main', 'path': 'xyz.default-release', 'relative': True, 'default': True})
        self.assertEqual([(p['name'], p['default'], p['relative']) for p in parsed[1:]], [('old', False, True), ('abs', False, False)])


class ReaderTests(ImportFixture):
    def build_chrome(self):
        default = self.chrome_profile('Default')
        work = self.chrome_profile('Profile 1')
        self.chrome_profile('Profile 3')
        (self.config / 'google-chrome' / 'Local State').write_text(json.dumps({'profile': {
            'last_used': 'Profile 1', 'profiles_order': ['Profile 1', 'Default'],
            'info_cache': {'Default': {'name': 'Personal', 'user_name': 'me@example.com', 'profile_highlight_color': -16749376},
                           'Profile 1': {'name': 'Work', 'default_avatar_fill_color': -16777216},
                           'Gone': {'name': 'Missing dir'}}}}))
        (default / 'Bookmarks').write_text(json.dumps({'roots': {
            'bookmark_bar': folder('Bookmarks bar', [bookmark('A', 'https://a.example/'), folder('Nested', [bookmark('B', 'https://b.example/'), folder('Inner', [bookmark('C', 'https://c.example/')])])]),
            'other': folder('Other bookmarks', [bookmark('D', 'https://d.example/'), {'type': 'url', 'name': 'blank', 'url': ''}]),
            'synced': folder('Mobile bookmarks', []),
        }, 'version': 1}))
        (default / 'AccountBookmarks').write_text(json.dumps({'roots': {
            'bookmark_bar': folder('', [bookmark('E', 'https://e.example/')]),
            'synced': folder('', [bookmark('F', 'https://f.example/')]),
        }}))
        history = make_history(default / 'History', [
            ('https://new.example/', 'New', 5, 2, webkit(1700000300000), 0),
            ('https://mid.example/', 'Mid', 1, 0, webkit(1700000200000), 0),
            ('https://old.example/', 'Old', 0, 0, webkit(1600000000000), 0),
            ('https://hidden.example/', 'Hidden', 3, 0, webkit(1700000100000), 1),
            ('chrome://settings/', 'Settings', 3, 0, webkit(1700000100000), 0),
            ('file:///etc/passwd', 'File', 3, 0, webkit(1700000100000), 0),
        ], wal=True)
        history.execute('INSERT INTO urls(url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?,?,?,?,?,?)',
                        ('https://wal-only.example/', 'In WAL', 2, 0, webkit(1700000400000), 0))
        history.commit()
        self.addCleanup(history.close)
        self.assertTrue((default / 'History-wal').exists())
        make_logins(default / 'Login Data', [
            ('https://site.example/login', '', 'alice', encrypt_v10('correct horse'), 'https://site.example/', webkit(1600000000000), 0, 3, webkit(1700000000000)),
            ('https://other.example/', '', 'bob', encrypt_v10('battery staple'), 'https://other.example/', webkit(1600000000000), 0, 0, 0),
            ('https://blocked.example/', '', '', b'', 'https://blocked.example/', webkit(1600000000000), 1, 0, 0),
            ('https://keyring.example/', '', 'kay', b'v11' + os.urandom(32), 'https://keyring.example/', webkit(1600000000000), 0, 0, 0),
            ('https://broken.example/', '', 'bee', b'v10' + os.urandom(31), 'https://broken.example/', webkit(1600000000000), 0, 0, 0),
        ])
        make_logins(default / 'Login Data For Account', [
            ('https://site.example/login', '', 'alice', encrypt_v10('correct horse'), 'https://site.example/', webkit(1600000000000), 0, 3, 0),
            ('https://account.example/', '', 'acc', encrypt_v10('acc pass'), 'https://account.example/', webkit(1600000000000), 0, 0, 0),
        ])
        (work / 'Bookmarks').write_text(json.dumps({'roots': {'bookmark_bar': folder('Bar', [bookmark('W', 'https://w.example/')])}}))
        return default

    def build_firefox(self):
        root = self.home / '.mozilla' / 'firefox'
        profile = root / 'abcd.default-release'
        profile.mkdir(parents=True)
        (root / 'missing.default').mkdir()
        (root / 'profiles.ini').write_text('[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\n\n'
                                           '[Profile1]\nName=gone\nIsRelative=1\nPath=nowhere\n\n'
                                           '[Profile2]\nName=escape\nIsRelative=1\nPath=../../etc\n\n'
                                           '[Profile3]\nName=abs\nIsRelative=0\nPath=/tmp\n\n'
                                           '[Install1]\nDefault=abcd.default-release\n')
        db = sqlite3.connect(profile / 'places.sqlite')
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0 NOT NULL, typed INTEGER DEFAULT 0 NOT NULL, last_visit_date INTEGER)')
        db.execute('CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER, position INTEGER, title LONGVARCHAR, dateAdded INTEGER, guid TEXT)')
        places = [(1, 'https://ff-a.example/', 'FF A', 4, 0, 1, 1700000000000000), (2, 'https://ff-b.example/', 'FF B', 1, 0, 0, 1690000000000000),
                  (3, 'place:sort=8', 'Recent', 0, 0, 0, None), (4, 'https://unvisited.example/', 'Never', 0, 0, 0, None)]
        db.executemany('INSERT INTO moz_places VALUES (?,?,?,?,?,?,?)', places)
        marks = [(1, 2, None, 0, 0, '', 1, 'root________'), (2, 2, None, 1, 0, 'menu', 1, 'menu________'),
                 (3, 2, None, 1, 1, 'toolbar', 1, 'toolbar_____'), (5, 2, None, 1, 3, 'unfiled', 1, 'unfiled_____'),
                 (6, 2, None, 1, 4, 'mobile', 1, 'mobile______'), (10, 1, 1, 3, 0, 'FF A', 1600000000000000, 'a1'),
                 (11, 2, None, 3, 1, 'Folder', 1600000000000000, 'f1'), (12, 1, 2, 11, 0, 'FF B', 0, 'b1'),
                 (13, 1, 3, 2, 0, 'Recent', 0, 'r1'), (14, 1, 4, 5, 0, 'Never', 0, 'n1')]
        db.executemany('INSERT INTO moz_bookmarks VALUES (?,?,?,?,?,?,?,?)', marks)
        db.commit()
        self.addCleanup(db.close)
        return profile

    def test_discovery_lists_chromium_and_firefox_profiles_and_skips_own_data(self):
        self.build_chrome()
        self.build_firefox()
        brave = self.chrome_profile('Default', 'BraveSoftware/Brave-Browser')
        (brave / 'History').write_bytes(b'')
        (self.config / 'chromium').mkdir()
        (self.config / 'vivaldi').mkdir()
        own = self.config / 'chromium'
        own_profile = own / 'Default'
        own_profile.mkdir()
        (own_profile / 'Preferences').write_text('{}')
        sources = self.json('discover', *self.env_args(own))
        ids = [s['id'] for s in sources]
        self.assertEqual(ids, ['chrome', 'brave', 'firefox'])
        chrome = sources[0]
        self.assertEqual((chrome['family'], chrome['requiresExport'], chrome['needsKeychain']), ('chromium', False, False))
        self.assertEqual([(p['id'], p['name'], p['isDefault']) for p in chrome['profiles']],
                         [('Profile 1', 'Work', True), ('Default', 'Personal', False), ('Profile 3', 'Profile 3', False)])
        personal = chrome['profiles'][1]
        self.assertEqual(personal['available'], ['bookmarks', 'history', 'passwords'])
        self.assertEqual(personal['email'], 'me@example.com')
        self.assertEqual(personal['color'], '#006cc0')
        self.assertNotIn('color', chrome['profiles'][0])
        self.assertEqual(sources[1]['profiles'][0]['available'], ['history'])
        firefox = sources[2]
        self.assertEqual([(p['id'], p['isDefault'], p['available']) for p in firefox['profiles']],
                         [('abcd.default-release', True, ['bookmarks', 'history'])])
        self.assertEqual(self.json('discover', *self.env_args())[1]['id'], 'chromium')

    def test_chromium_profile_import_reads_snapshots_without_touching_sources(self):
        default = self.build_chrome()
        before = tree_digests(self.home)
        out = self.read('chrome', 'Default', ['passwords', 'history', 'bookmarks', 'cookies'])
        self.assertEqual(tree_digests(self.home), before)
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertFalse(out['cancelled'])
        self.assertEqual(out['error'], '')
        result = out['result']
        self.assertEqual(result['profile'], {'name': 'Personal', 'color': '#006cc0'})
        bookmarks = result['bookmarks']
        self.assertEqual([(c['title'], c['role']) for c in bookmarks['children']],
                         [('Bookmarks bar', 'toolbar'), ('Other bookmarks', 'other'), ('Mobile Bookmarks', 'mobile')])
        self.assertEqual(sorted(links(bookmarks)), sorted(['https://a.example/', 'https://b.example/', 'https://c.example/', 'https://d.example/', 'https://e.example/', 'https://f.example/']))
        self.assertEqual(bookmarks['children'][0]['children'][0]['dateAdded'], 1700000000000)
        self.assertEqual([h['url'] for h in result['history']], ['https://wal-only.example/', 'https://new.example/', 'https://mid.example/', 'https://old.example/'])
        self.assertEqual(result['history'][1], {'url': 'https://new.example/', 'title': 'New', 'visits': 5, 'lastVisit': 1700000300000, 'typedCount': 2})
        self.assertEqual(result['history'][3]['visits'], 1)
        self.assertEqual(result['historyCount'], 4)
        self.assertEqual(result['credentials'], [])
        self.assertEqual(result['failed'], [])
        self.assertEqual(sorted((c['url'], c['username'], c['password']) for c in out['credentials']), [
            ('https://account.example/', 'acc', 'acc pass'),
            ('https://other.example/', 'bob', 'battery staple'),
            ('https://site.example/login', 'alice', 'correct horse'),
        ])
        site = next(c for c in out['credentials'] if c['username'] == 'alice')
        self.assertEqual((site['realm'], site['created'], site['lastUsed'], site['timesUsed']), ('https://site.example/', 1600000000000, 1700000000000, 3))
        codes = [(w['kind'], w['code']) for w in result['warnings']]
        self.assertIn(('passwords', 'locked'), codes)
        self.assertIn(('passwords', 'undecryptable'), codes)
        self.assertIn(('cookies', 'empty'), codes)
        self.assertTrue(any(w['message'] == "1 password protected by the system keyring wasn't imported" for w in result['warnings']))
        self.assertTrue(any('1 password couldn' in w['message'] for w in result['warnings']))
        serialized = json.dumps(result)
        for secret in ['correct horse', 'battery staple', 'acc pass']:
            self.assertNotIn(secret, serialized)
        phases = [(p['kind'], p['phase']) for p in out['progress']]
        self.assertEqual(phases, [('bookmarks', 'start'), ('bookmarks', 'end'), ('history', 'start'), ('history', 'end'),
                                  ('passwords', 'start'), ('passwords', 'end'), ('cookies', 'start'), ('cookies', 'end')])
        self.assertEqual(out['progress'][3]['processed'], 4)
        self.assertTrue((default / 'History-wal').exists())

    def test_history_limit_and_since(self):
        self.build_chrome()
        limited = self.read('chrome', 'Default', ['history'], limit=2)['result']
        self.assertEqual([h['url'] for h in limited['history']], ['https://wal-only.example/', 'https://new.example/'])
        since = self.read('chrome', 'Default', ['history'], since=1700000250000)['result']
        self.assertEqual([h['url'] for h in since['history']], ['https://wal-only.example/', 'https://new.example/'])

    def test_missing_profiles_and_traversal_are_rejected(self):
        self.build_chrome()
        for profile in ['../google-chrome/Default', 'Nope', '/etc', '..']:
            self.assertEqual(self.read('chrome', profile, ['bookmarks'])['error'], 'notFound', profile)
        self.assertEqual(self.read('safari', 'Default', ['bookmarks'])['error'], 'notFound')

    def test_firefox_profile_import(self):
        self.build_firefox()
        before = tree_digests(self.home)
        out = self.read('firefox', 'abcd.default-release', ['bookmarks', 'history', 'passwords'])
        self.assertEqual(tree_digests(self.home), before)
        self.assertEqual(list(self.temp.iterdir()), [])
        result = out['result']
        self.assertEqual([(c['title'], c['role']) for c in result['bookmarks']['children']],
                         [('Bookmarks Toolbar', 'toolbar'), ('Other Bookmarks', 'other')])
        toolbar = result['bookmarks']['children'][0]
        self.assertEqual(toolbar['children'][0], {'type': 'url', 'title': 'FF A', 'url': 'https://ff-a.example/', 'dateAdded': 1600000000000})
        self.assertEqual(toolbar['children'][1]['children'][0]['url'], 'https://ff-b.example/')
        self.assertEqual([(h['url'], h['visits'], h['lastVisit'], h['typedCount']) for h in result['history']],
                         [('https://ff-a.example/', 4, 1700000000000, 1), ('https://ff-b.example/', 1, 1690000000000, 0)])
        self.assertEqual(result['failed'], [])
        self.assertEqual([(w['kind'], w['code']) for w in result['warnings']], [('passwords', 'empty')])
        self.assertNotIn('profile', result)

class ScratchSweepTests(ImportFixture):
    def test_stale_import_copies_left_by_a_crash_are_removed(self):
        old = self.temp / 'ardia-import-old111'
        fresh = self.temp / 'ardia-import-new222'
        other = self.temp / 'unrelated-old'
        for directory in (old, fresh, other):
            directory.mkdir()
            (directory / 'copy-1').write_bytes(b'snapshot')
        (self.temp / 'ardia-import-file').write_text('not a directory')
        now = 2_000_000_000
        os.utime(old, (now - 7200, now - 7200))
        os.utime(other, (now - 7200, now - 7200))
        os.utime(fresh, (now - 60, now - 60))
        self.assertEqual(self.run_binary('sweep', self.temp, now, 3600).strip(), '1')
        self.assertEqual(sorted(p.name for p in self.temp.iterdir()), ['ardia-import-file', 'ardia-import-new222', 'unrelated-old'])


if __name__ == '__main__':
    unittest.main()
