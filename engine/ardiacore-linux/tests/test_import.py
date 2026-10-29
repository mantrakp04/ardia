import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'
WEBKIT_OFFSET = 11644473600000000
SHIMS = {
    'base/values.h': '#include "import_base.h"\n',
    'base/json/json_reader.h': '#include "import_base.h"\n',
    'third_party/sqlite/sqlite3.h': '#include <sqlite3.h>\n',
    'third_party/boringssl/src/include/openssl/evp.h': '#include <openssl/evp.h>\n',
    'third_party/boringssl/src/include/openssl/hmac.h': '#include <openssl/hmac.h>\n',
    'third_party/boringssl/src/include/openssl/sha.h': '#include <openssl/sha.h>\n',
}
IMPORT_SOURCES = ['ac_linux_import_formats.cc', 'ac_linux_import_readers.cc', 'ac_linux_import_crypto.cc',
                  'ac_linux_import_storage.cc', 'ac_linux_import_secrets.cc', 'ac_linux_import_sessions.cc',
                  'ac_linux_import_keyring.cc']


def basic_key():
    return hashlib.pbkdf2_hmac('sha1', b'peanuts', b'saltysalt', 1, 16)


def encrypt_v10(password):
    result = subprocess.run(['openssl', 'enc', '-aes-128-cbc', '-K', basic_key().hex(), '-iv', '20' * 16, '-nosalt'],
                            input=password.encode(), capture_output=True, timeout=30, check=True)
    return b'v10' + result.stdout


def encrypt_with(key, password):
    result = subprocess.run(['openssl', 'enc', '-aes-128-cbc', '-K', key.hex(), '-iv', '20' * 16, '-nosalt'],
                            input=password.encode(), capture_output=True, timeout=30, check=True)
    return b'v10' + result.stdout


def webkit(ms):
    return ms * 1000 + WEBKIT_OFFSET


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def tree_digests(root):
    return {str(path.relative_to(root)): digest(path) for path in sorted(pathlib.Path(root).rglob('*')) if path.is_file()}


def links(node):
    if node['type'] == 'url':
        return [node['url']]
    return [url for child in node.get('children', []) for url in links(child)]


def make_history(path, rows, wal=False):
    db = sqlite3.connect(path)
    if wal:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA wal_autocheckpoint=0')
    db.execute('CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)')
    db.executemany('INSERT INTO urls(url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?,?,?,?,?,?)', rows)
    db.commit()
    return db


def make_logins(path, rows):
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE logins(origin_url VARCHAR NOT NULL, action_url VARCHAR, username_value VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, times_used INTEGER, date_last_used INTEGER NOT NULL DEFAULT 0)')
    db.executemany('INSERT INTO logins(origin_url, action_url, username_value, password_value, signon_realm, date_created, blacklisted_by_user, times_used, date_last_used) VALUES (?,?,?,?,?,?,?,?,?)', rows)
    db.commit()
    db.close()


def bookmark(name, url, added_ms=1700000000000):
    return {'type': 'url', 'name': name, 'url': url, 'date_added': str(webkit(added_ms))}


def folder(name, children):
    return {'type': 'folder', 'name': name, 'children': children, 'date_added': str(webkit(1600000000000))}


class ImportFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None or shutil.which('openssl') is None:
            raise unittest.SkipTest('C++ compiler or openssl is unavailable')
        cls.build = tempfile.TemporaryDirectory(prefix='ardia-import-build-')
        root = pathlib.Path(cls.build.name)
        include = root / 'include'
        for name, text in SHIMS.items():
            (include / name).parent.mkdir(parents=True, exist_ok=True)
            (include / name).write_text(text)
        shutil.copy(FIXTURES / 'import_base.h', include / 'import_base.h')
        cls.binary = root / 'import-scenarios'
        compiled = subprocess.run([
            compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
            '-fno-omit-frame-pointer', f'-I{include}', '-I', str(ROOT / 'src'),
            *[str(LINUX / name) for name in IMPORT_SOURCES],
            str(FIXTURES / 'import_scenarios.cc'), '-lsqlite3', '-lcrypto', '-ldl', '-o', str(cls.binary),
        ], capture_output=True, text=True, timeout=300)
        if compiled.returncode != 0:
            raise AssertionError(compiled.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='ardia-import-')
        self.root = pathlib.Path(self.scratch.name)
        self.home = self.root / 'home'
        self.config = self.home / '.config'
        self.temp = self.root / 'tmp'
        for path in (self.config, self.temp):
            path.mkdir(parents=True)

    def tearDown(self):
        self.scratch.cleanup()

    def run_binary(self, *args):
        result = subprocess.run([str(self.binary), *[str(a) for a in args]], capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def json(self, *args):
        return json.loads(self.run_binary(*args))

    def env_args(self, own=''):
        return [self.home, self.config, self.temp, own]

    def read(self, browser, profile, kinds, limit=0, since=0, cancel_at=0):
        return self.json('read', *self.env_args(), browser, profile, ','.join(kinds), limit, since, cancel_at)

    def chrome_profile(self, name='Default', root='google-chrome'):
        profile = self.config / root / name
        profile.mkdir(parents=True)
        (profile / 'Preferences').write_text('{}')
        return profile


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

    def test_bookmark_html_limits_and_errors(self):
        deep = self.root / 'deep.html'
        levels = 80
        deep.write_text('<DL><p>' + ''.join(f'<DT><H3>L{i}</H3><DL><p>' for i in range(levels)) +
                        '<DT><A HREF="https://deep.example/">Deep</A>' + '</DL><p>' * (levels + 1))
        parsed = self.json('html', deep)
        self.assertTrue(parsed['truncated'])
        self.assertEqual(links(parsed['root']), ['https://deep.example/'])
        empty = self.root / 'empty.html'
        empty.write_text('<html><body>No bookmarks here</body></html>')
        self.assertEqual(self.json('html', empty)['error'], 'empty')
        latin = self.root / 'latin.html'
        latin.write_bytes(b'<DL><p><DT><A HREF="https://caf.example/">Caf\xe9</A></DL>')
        self.assertEqual(self.json('html', latin)['root']['children'][0]['title'], 'Café')

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

        firefox = self.root / 'firefox.csv'
        firefox.write_text('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n'
                           '"https://ff.example","u1","p1",,"https://ff.example","{1}","1600000000000","1700000000000","1600000000000"\n'
                           '"https://auth.example","u2","p2","Members Area",,"{2}","1600000000000","1600000000000","1600000000000"\n')
        parsed = self.json('csv', firefox)
        self.assertEqual((parsed['rows'], parsed['invalid'], parsed['duplicates']), (2, 0, 0))
        self.assertEqual(parsed['credentials'][0]['created'], 1600000000000)
        self.assertEqual(parsed['credentials'][0]['lastUsed'], 1700000000000)
        self.assertEqual(parsed['credentials'][1]['realm'], 'Members Area')

        bitwarden = self.root / 'bitwarden.csv'
        bitwarden.write_text('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n'
                             'Work,1,login,Site,a note,,0,"https://bw.example/a,https://bw2.example",user,bwpass,otpauth://x\n'
                             ',,note,Secure note,secret text,,0,,,,\n'
                             ',,login,No uri,,,0,,user,pw,\n')
        parsed = self.json('csv', bitwarden)
        self.assertEqual((parsed['rows'], parsed['invalid'], parsed['duplicates']), (2, 1, 0))
        self.assertEqual(parsed['credentials'][0]['url'], 'https://bw.example/a')
        self.assertEqual(parsed['credentials'][0]['title'], 'Site')
        self.assertEqual(parsed['credentials'][0]['note'], 'a note')

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

    def test_partial_errors_keep_the_readable_kinds(self):
        default = self.chrome_profile('Default')
        (default / 'Bookmarks').write_text(json.dumps({'roots': {'bookmark_bar': folder('Bar', [bookmark('A', 'https://a.example/')])}}))
        (default / 'History').write_bytes(b'this is not a database' * 100)
        (default / 'Login Data').write_bytes(b'')
        make_logins(default / 'Login Data For Account', [
            ('https://k.example/', '', 'k', b'v11' + os.urandom(32), 'https://k.example/', webkit(1600000000000), 0, 0, 0)])
        out = self.read('chrome', 'Default', ['bookmarks', 'history', 'passwords'])
        result = out['result']
        self.assertEqual(links(result['bookmarks']), ['https://a.example/'])
        self.assertEqual(sorted(result['failed']), ['history', 'passwords'])
        self.assertEqual(out['credentials'], [])
        self.assertEqual(list(self.temp.iterdir()), [])
        broken = self.chrome_profile('Profile 9')
        (broken / 'Bookmarks').write_text('{not json')
        out = self.read('chrome', 'Profile 9', ['bookmarks'])
        self.assertEqual(out['result']['failed'], ['bookmarks'])
        self.assertEqual(out['result']['warnings'][0]['code'], 'unreadable')

    def test_missing_profiles_and_traversal_are_rejected(self):
        self.build_chrome()
        for profile in ['../google-chrome/Default', 'Nope', '/etc', '..']:
            self.assertEqual(self.read('chrome', profile, ['bookmarks'])['error'], 'notFound', profile)
        self.assertEqual(self.read('safari', 'Default', ['bookmarks'])['error'], 'notFound')

    def test_cancellation_stops_reading_and_cleans_temporary_copies(self):
        default = self.chrome_profile('Default')
        rows = [(f'https://h{i}.example/', f'H{i}', 1, 0, webkit(1700000000000 + i), 0) for i in range(3000)]
        make_history(default / 'History', rows).close()
        make_logins(default / 'Login Data', [
            ('https://site.example/', '', 'alice', encrypt_v10('never returned'), 'https://site.example/', webkit(1600000000000), 0, 0, 0)])
        before = tree_digests(self.home)
        out = self.read('chrome', 'Default', ['passwords', 'history'], cancel_at=1000)
        self.assertTrue(out['cancelled'])
        self.assertEqual(out['credentials'], [])
        self.assertNotIn('never returned', json.dumps(out))
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertEqual(tree_digests(self.home), before)
        self.assertIn({'kind': 'history', 'phase': 'progress', 'processed': 1000, 'total': 3000}, out['progress'])
        self.assertNotIn(('history', 'end'), [(p['kind'], p['phase']) for p in out['progress']])

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

    def test_extensions_come_from_preferences_and_locales(self):
        default = self.chrome_profile('Default')
        ext = 'a' * 32
        localized = 'b' * 32
        (default / 'Extensions' / localized / '1.0' / '_locales' / 'en').mkdir(parents=True)
        (default / 'Extensions' / localized / '1.0' / 'manifest.json').write_text(json.dumps({'name': '__MSG_appName__', 'default_locale': 'en'}))
        (default / 'Extensions' / localized / '1.0' / '_locales' / 'en' / 'messages.json').write_text(json.dumps({'APPNAME': {'message': 'Localized'}}))
        (default / 'Preferences').write_text(json.dumps({'extensions': {'settings': {
            ext: {'from_webstore': True, 'location': 1, 'manifest': {'name': ' Zeta '}},
            localized: {'path': f'{localized}/1.0'},
            'c' * 32: {'from_webstore': False, 'location': 1, 'manifest': {'name': 'Unpacked'}},
            'd' * 32: {'from_webstore': True, 'location': 5, 'manifest': {'name': 'Component'}},
            'cjpalhdlnbpafiamejdnhcphjbkeiagm': {'from_webstore': True, 'location': 1},
            'not-an-id': {'from_webstore': True},
        }}}))
        (default / 'Secure Preferences').write_text(json.dumps({'extensions': {'settings': {localized: {'from_webstore': True, 'location': 1}}}}))
        listed = self.json('extensions', *self.env_args(), 'chrome', 'Default')
        self.assertEqual(listed, [
            {'id': localized, 'name': 'Localized', 'webStoreUrl': f'https://chromewebstore.google.com/detail/{localized}'},
            {'id': ext, 'name': 'Zeta', 'webStoreUrl': f'https://chromewebstore.google.com/detail/{ext}'},
        ])
        self.assertEqual(self.json('extensions', *self.env_args(), 'firefox', 'x'), [])


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


class ReviewRoundOneTests(ImportFixture):
    def test_chunks_counts_summaries_leak_gate_expiry_and_v12(self):
        self.assertIn('review units passed', self.run_binary('review'))

    def test_empty_key_fallback_and_v12_are_handled_like_chromium(self):
        default = self.chrome_profile('Default')
        empty_key = hashlib.pbkdf2_hmac('sha1', b'', b'saltysalt', 1, 16)
        make_logins(default / 'Login Data', [
            ('https://empty.example/', '', 'e', encrypt_with(empty_key, 'empty key pass'), 'https://empty.example/', webkit(1600000000000), 0, 0, 0),
            ('https://portal.example/', '', 'p', b'v12' + os.urandom(32), 'https://portal.example/', webkit(1600000000000), 0, 0, 0),
        ])
        out = self.read('chrome', 'Default', ['passwords'])
        self.assertEqual([(c['username'], c['password']) for c in out['credentials']], [('e', 'empty key pass')])
        messages = [w['message'] for w in out['result']['warnings']]
        self.assertIn("1 password protected by the desktop portal wasn't imported. The desktop portal gives each app its own key, "
                      "so Ardia can't read Google Chrome's. Export them from Google Chrome's password manager as a CSV file and "
                      "import that file.", messages)
        self.assertFalse(any('decrypted' in m for m in messages))

    def test_fifos_are_refused_without_blocking(self):
        fifo = self.root / 'fifo.html'
        os.mkfifo(fifo)
        result = subprocess.run([str(self.binary), 'readfile', str(fifo)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.stdout.strip(), '3')
        default = self.chrome_profile('Default')
        os.mkfifo(default / 'History')
        os.mkfifo(default / 'Bookmarks')
        run = subprocess.run([str(self.binary), 'read', *[str(a) for a in self.env_args()], 'chrome', 'Default', 'history,bookmarks', '0', '0', '0'],
                             capture_output=True, text=True, timeout=20)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)['result']
        self.assertNotIn('bookmarks', result)
        self.assertEqual(result['history'], [])
        self.assertEqual(sorted((w['kind'], w['code']) for w in result['warnings']), [('bookmarks', 'empty'), ('history', 'empty')])

    def test_own_data_directory_is_never_read(self):
        self.chrome_profile('Default')
        out = self.json('read', self.home, self.config, self.temp, self.config / 'google-chrome', 'chrome', 'Default', 'bookmarks', 0, 0, 0)
        self.assertEqual(out['error'], 'notFound')

    def test_service_wiring_from_review(self):
        service = (LINUX / 'ac_linux_import_service.cc').read_text()
        self.assertNotIn('ERR_FILE_CHOOSER_UNAVAILABLE', service)
        self.assertNotIn('CredentialRows', service + (LINUX / 'ac_linux_import_formats.h').read_text())
        self.assertIn('kPasswordChunk', service)
        self.assertIn('PostDelayedTask', service)
        self.assertIn('AddAppTerminatingCallback', service)
        self.assertIn('ReplyLeaksSecret', service)
        self.assertIn('"ArdiaImport.cancelChooser"', (LINUX / 'ac_linux_import_formats.h').read_text())
        self.assertIn('"//chrome/browser/lifetime:termination_notification"', (LINUX / 'BUILD.gn').read_text())


class ImportSourceRules(unittest.TestCase):
    def test_import_sources_have_no_comments_and_are_built(self):
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ['ac_linux_import_formats', 'ac_linux_import_readers', 'ac_linux_import_service']:
            for suffix in ['.cc', '.h']:
                path = LINUX / f'{name}{suffix}'
                self.assertTrue(path.exists(), path)
                self.assertIn(f'"{name}{suffix}"', build)
                text = path.read_text()
                self.assertIsNone(re.search(r'(^|\s)//(?!\s*nogncheck)|/\*', text), path)
        for dep in ['//third_party/sqlite', '//third_party/boringssl', '//components/password_manager/core/browser/import:importer',
                    '//chrome/browser/extensions/api/passwords_private', '//ui/shell_dialogs']:
            self.assertIn(f'"{dep}"', build)


if __name__ == '__main__':
    unittest.main()
