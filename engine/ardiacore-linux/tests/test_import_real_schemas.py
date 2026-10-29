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

from test_import import FIXTURES, IMPORT_SOURCES, LINUX, ROOT, SHIMS, ImportFixture, basic_key, links, webkit
from test_import_followups import NOW_MS, aes_cbc

PROFILES = FIXTURES / 'real-profiles'
CHROMIUM_CANDIDATES = [os.environ.get('ARDIA_CHROMIUM_SRC', ''),
                       str(pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src')]
OMITTED = {'SQLITE_OMIT_UPSERT', 'SQLITE_OMIT_WINDOWFUNC', 'SQLITE_OMIT_JSON', 'SQLITE_DQS=0'}
UNBUILDABLE = {'SQLITE_ENABLE_ICU', 'SQLITE_HAVE_SQLITE3R'}
FIREFOX = {'159': 87, '153esr': 86}


def chromium_source():
    for candidate in CHROMIUM_CANDIDATES:
        if candidate and (pathlib.Path(candidate) / 'third_party/sqlite/src/amalgamation/sqlite3.c').exists():
            return pathlib.Path(candidate)
    return None


def chromium_sqlite_flags(src):
    flags = []
    for name in ['sqlite_common_configuration_flags.gni', 'sqlite_chromium_configuration_flags.gni']:
        flags += re.findall(r'"(SQLITE_[A-Z0-9_]+(?:=[^"]*)?)"', (src / 'third_party/sqlite' / name).read_text())
    return [flag for flag in flags if flag not in UNBUILDABLE]


def create(path, schema, wal=False):
    db = sqlite3.connect(path)
    if wal:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA wal_autocheckpoint=0')
    db.executescript((PROFILES / schema).read_text())
    db.commit()
    return db


def chromium_constant(src, path, name):
    match = re.search(rf'{name}\s*=\s*(\d+);', (src / path).read_text())
    return int(match.group(1)) if match else None


class ChromiumSqliteImport(ImportFixture):
    @classmethod
    def setUpClass(cls):
        src = chromium_source()
        compiler = shutil.which('clang++') or shutil.which('c++')
        c_compiler = shutil.which('clang') or shutil.which('cc')
        if src is None:
            raise unittest.SkipTest('the Chromium 156 source tree is unavailable')
        if compiler is None or c_compiler is None or shutil.which('openssl') is None:
            raise unittest.SkipTest('a compiler or openssl is unavailable')
        cls.src = src
        cls.flags = chromium_sqlite_flags(src)
        amalgamation = src / 'third_party/sqlite/src/amalgamation'
        cls.build = tempfile.TemporaryDirectory(prefix='ardia-import-chromium-sqlite-')
        root = pathlib.Path(cls.build.name)
        sqlite_object = root / 'sqlite3.o'
        compiled = subprocess.run([c_compiler, '-c', '-O1', '-w', *[f'-D{flag}' for flag in cls.flags],
                                   str(amalgamation / 'sqlite3.c'), '-o', str(sqlite_object)],
                                  capture_output=True, text=True, timeout=600)
        if compiled.returncode != 0:
            raise AssertionError(compiled.stderr)
        cls.probe = root / 'probe'
        compiled = subprocess.run([c_compiler, '-O1', f'-I{amalgamation}', str(FIXTURES / 'chromium_sqlite_probe.c'),
                                   str(sqlite_object), '-lpthread', '-lm', '-o', str(cls.probe)],
                                  capture_output=True, text=True, timeout=300)
        if compiled.returncode != 0:
            raise AssertionError(compiled.stderr)
        include = root / 'include'
        for name, text in {**SHIMS, 'third_party/sqlite/sqlite3.h': f'#include "{amalgamation}/sqlite3.h"\n'}.items():
            (include / name).parent.mkdir(parents=True, exist_ok=True)
            (include / name).write_text(text)
        shutil.copy(FIXTURES / 'import_base.h', include / 'import_base.h')
        cls.binary = root / 'import-scenarios'
        compiled = subprocess.run([
            compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
            '-fno-omit-frame-pointer', f'-I{include}', '-I', str(ROOT / 'src'),
            *[str(LINUX / name) for name in IMPORT_SOURCES],
            str(FIXTURES / 'import_scenarios.cc'), str(sqlite_object), '-lcrypto', '-ldl', '-lpthread', '-lm',
            '-o', str(cls.binary),
        ], capture_output=True, text=True, timeout=600)
        if compiled.returncode != 0:
            raise AssertionError(compiled.stderr)

    def probe_sql(self, database, *statements):
        result = subprocess.run([str(self.probe), str(database), *statements], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_the_build_uses_chromium_sqlite_without_upsert_window_functions_json_or_double_quoted_strings(self):
        self.assertTrue(OMITTED <= set(self.flags), self.flags)
        database = self.root / 'probe.sqlite'
        sqlite3.connect(database).execute('CREATE TABLE t(a INTEGER PRIMARY KEY)').connection.commit()
        results = self.probe_sql(database, 'SELECT 1', "SELECT json('{}')", 'SELECT row_number() OVER () FROM t',
                                 'INSERT INTO t VALUES(1) ON CONFLICT DO NOTHING', 'SELECT "text" FROM t')
        self.assertEqual([r['ok'] for r in results], [True, False, False, False, False], results)

    def test_profile_schemas_are_the_versions_chromium_156_writes(self):
        versions = {}
        for name in ['History', 'Login-Data', 'Cookies', 'Favicons']:
            db = create(self.root / name, f'chromium-155-{name}.sql')
            versions[name] = int(db.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()[0])
            db.close()
        self.assertEqual(versions, {
            'History': chromium_constant(self.src, 'components/history/core/browser/history_database.cc', 'kCurrentVersionNumber'),
            'Login-Data': chromium_constant(self.src, 'components/password_manager/core/browser/password_store/login_database.cc', 'kCurrentVersionNumber'),
            'Cookies': chromium_constant(self.src, 'net/extras/sqlite/sqlite_persistent_cookie_store.cc', 'kCurrentVersionNumber'),
            'Favicons': chromium_constant(self.src, 'components/favicon/core/favicon_database.cc', 'kCurrentVersionNumber'),
        })
        for version, user_version in FIREFOX.items():
            db = create(self.root / f'places-{version}.sqlite', f'firefox-{version}-places.sql')
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], user_version)
            db.close()

    def build_chrome_155(self):
        profile = self.chrome_profile('Default')
        (self.config / 'google-chrome' / 'Local State').write_text(json.dumps({'profile': {'info_cache': {'Default': {'name': 'Person 1'}}}}))
        (profile / 'Bookmarks').write_text(json.dumps({'roots': {
            'bookmark_bar': {'type': 'folder', 'name': 'Bookmarks bar', 'date_added': str(webkit(1600000000000)), 'children': [
                {'type': 'url', 'name': 'Chromium', 'url': 'https://www.chromium.org/', 'date_added': str(webkit(1600000000000))}]},
            'other': {'type': 'folder', 'name': 'Other bookmarks', 'children': []},
            'synced': {'type': 'folder', 'name': 'Mobile bookmarks', 'children': []}}, 'version': 1}))
        history = create(profile / 'History', 'chromium-155-History.sql', wal=True)
        history.executemany('INSERT INTO urls(url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?,?,?,?,?,?)', [
            ('https://news.example/', 'News', 4, 1, webkit(1699000000000), 0),
            ('https://docs.example/a', 'Docs', 1, 0, webkit(1698000000000), 0),
            ('chrome://settings/', 'Settings', 2, 0, webkit(1697000000000), 0),
        ])
        history.execute('INSERT INTO visits(url, visit_time, from_visit, external_referrer_url, transition, segment_id, visit_duration, incremented_omnibox_typed_score, opener_visit, originator_cache_guid, originator_visit_id, originator_from_visit, originator_opener_visit, is_known_to_sync, consider_for_ntp_most_visited, visited_link_id, app_id) '
                        "VALUES (1, ?, 0, '', 805306369, 0, 0, 1, 0, '', 0, 0, 0, 0, 1, 0, NULL)", (webkit(1699000000000),))
        history.commit()
        self.addCleanup(history.close)
        logins = create(profile / 'Login Data', 'chromium-155-Login-Data.sql')
        logins.executemany('INSERT INTO logins(origin_url, action_url, username_element, username_value, password_element, password_value, '
                           'submit_element, signon_realm, date_created, blacklisted_by_user, scheme, password_type, times_used, '
                           'date_last_used, date_password_modified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                               ('https://login.example/', 'https://login.example/session', 'user', 'ada', 'pass',
                                aes_cbc(basic_key(), b'analytical engine'), '', 'https://login.example/', webkit(1600000000000), 0, 0, 0, 2,
                                webkit(1690000000000), webkit(1600000000000)),
                               ('https://never.example/', '', '', '', '', b'', '', 'https://never.example/', webkit(1600000000000), 1, 0, 0, 0, 0, 0),
                           ])
        logins.commit()
        logins.close()
        create(profile / 'Login Data For Account', 'chromium-155-Login-Data.sql').close()
        web = create(profile / 'Web Data', 'chromium-155-Web-Data.sql')
        web.execute("INSERT INTO addresses(guid, use_count, use_date, date_modified, language_code, label, initial_creator_id, record_type) "
                    "VALUES ('a1', 2, 0, 0, 'en', '', 0, 0)")
        web.executemany("INSERT INTO address_type_tokens(guid, type, value, verification_status, observations) VALUES ('a1', ?, ?, 0, x'')", [
            (7, 'Ada Lovelace'), (77, '12 Analytical St'), (33, 'London'), (35, 'N1'), (36, 'gb'), (9, 'ada@example.com')])
        web.execute('INSERT INTO credit_cards(guid, name_on_card, expiration_month, expiration_year, card_number_encrypted, date_modified, '
                    "use_count, use_date, billing_address_id, nickname, is_user_confirmed) VALUES ('c1', 'Ada Lovelace', 4, 2031, ?, 0, 0, 0, '', 'Main', 1)",
                    (aes_cbc(basic_key(), b'4111111111111111'),))
        web.commit()
        web.close()
        cookies = create(profile / 'Cookies', 'chromium-155-Cookies.sql')
        hashed = hashlib.sha256(b'.login.example').digest() + b'session-value'
        cookies.execute('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
            webkit(1600000000000), '.login.example', '', 'sid', '', aes_cbc(basic_key(), hashed), '/', webkit(NOW_MS + 86400000),
            1, 1, webkit(1650000000000), 1, 1, 1, 1, 2, 443, webkit(1650000000000), 0, 0))
        cookies.commit()
        cookies.close()
        return profile

    def test_a_chrome_155_profile_imports_every_kind_through_chromium_sqlite(self):
        self.build_chrome_155()
        out = self.json('read', *self.env_args(), 'chrome', 'Default', 'bookmarks,history,passwords,cookies,autofill', 0, 0, 0, '-', '-', NOW_MS)
        self.assertEqual(out['error'], '')
        result = out['result']
        self.assertEqual(result['failed'], [])
        self.assertEqual(links(result['bookmarks']), ['https://www.chromium.org/'])
        self.assertEqual([(h['url'], h['visits'], h['typedCount']) for h in result['history']],
                         [('https://news.example/', 4, 1), ('https://docs.example/a', 1, 0)])
        self.assertEqual([(c['url'], c['username'], c['password'], c['timesUsed']) for c in out['credentials']],
                         [('https://login.example/', 'ada', 'analytical engine', 2)])
        self.assertEqual([(c['name'], c['value'], c['domain'], c['sameSite']) for c in out['cookies']],
                         [('sid', 'session-value', '.login.example', 'lax')])
        self.assertEqual([(a['name'], a['street'], a['country'], a['email']) for a in out['addresses']],
                         [('Ada Lovelace', '12 Analytical St', 'GB', 'ada@example.com')])
        self.assertEqual([(c['number'], c['expMonth'], c['expYear']) for c in out['cards']], [('4111111111111111', 4, 2031)])

    def build_firefox(self, version):
        root = self.home / '.mozilla' / 'firefox'
        profile = root / f'real.{version}'
        profile.mkdir(parents=True)
        (root / 'profiles.ini').write_text(f'[Profile0]\nName={version}\nIsRelative=1\nPath=real.{version}\nDefault=1\n')
        places = create(profile / 'places.sqlite', f'firefox-{version}-places.sql', wal=True)
        places.executemany('INSERT INTO moz_places(id, url, title, rev_host, visit_count, hidden, typed, frecency, last_visit_date, guid, url_hash) '
                           'VALUES (?,?,?,?,?,0,?,100,?,?,0)', [
                               (1, 'https://www.mozilla.org/', 'Mozilla', 'gro.allizom.www.', 3, 1, 1699000000000000, 'place1aaaaaa'),
                               (2, 'https://developer.mozilla.org/', 'MDN', 'gro.allizom.repoleved.', 1, 0, 1698000000000000, 'place2aaaaaa'),
                               (3, 'place:sort=8&maxResults=10', 'Recent Tags', None, 0, 0, None, 'place3aaaaaa')])
        places.executemany('INSERT INTO moz_bookmarks(id, type, fk, parent, position, title, dateAdded, lastModified, guid) VALUES (?,?,?,?,?,?,?,?,?)', [
            (1, 2, None, 0, 0, '', 1600000000000000, 1600000000000000, 'root________'),
            (2, 2, None, 1, 0, 'menu', 1600000000000000, 1600000000000000, 'menu________'),
            (3, 2, None, 1, 1, 'toolbar', 1600000000000000, 1600000000000000, 'toolbar_____'),
            (4, 2, None, 1, 2, 'tags', 1600000000000000, 1600000000000000, 'tags________'),
            (5, 2, None, 1, 3, 'unfiled', 1600000000000000, 1600000000000000, 'unfiled_____'),
            (6, 2, None, 1, 4, 'mobile', 1600000000000000, 1600000000000000, 'mobile______'),
            (7, 1, 1, 3, 0, 'Mozilla', 1600000000000000, 1600000000000000, 'bookmark1aaa'),
            (8, 1, 2, 2, 0, 'MDN', 1600000000000000, 1600000000000000, 'bookmark2aaa')])
        places.commit()
        self.addCleanup(places.close)
        cookies = create(profile / 'cookies.sqlite', f'firefox-{version}-cookies.sql')
        cookies.executemany('INSERT INTO moz_cookies(originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, '
                            'isHttpOnly, inBrowserElement, sameSite, schemeMap, isPartitionedAttributeSet, updateTime) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,0,?)', [
                                ('', 'plain', '1', 'localhost', '/', NOW_MS + 3600000, 1699999000000000, 1699999000000000, 0, 0, 256, 1, 1699999000000000),
                                ('', 'lax', '2', 'localhost', '/', NOW_MS + 3600000, 1699999000000000, 1699999000000000, 0, 0, 1, 1, 1699999000000000),
                                ('', 'strict', '3', 'localhost', '/', NOW_MS + 3600000, 1699999000000000, 1699999000000000, 0, 1, 2, 1, 1699999000000000),
                                ('', 'gone', '4', 'localhost', '/', NOW_MS - 1000, 1699999000000000, 1699999000000000, 0, 0, 256, 1, 1699999000000000)])
        cookies.commit()
        cookies.close()
        create(profile / 'favicons.sqlite', f'firefox-{version}-favicons.sql').close()
        (profile / 'sessionstore-backups').mkdir()
        shutil.copy(PROFILES / f'firefox-{version}-recovery.jsonlz4', profile / 'sessionstore-backups' / 'recovery.jsonlz4')
        return profile

    def test_current_firefox_release_and_esr_profiles_import_through_chromium_sqlite(self):
        for version in FIREFOX:
            with self.subTest(version=version):
                if (self.home / '.mozilla').exists():
                    shutil.rmtree(self.home / '.mozilla')
                self.build_firefox(version)
                out = self.json('read', *self.env_args(), 'firefox', f'real.{version}', 'bookmarks,history,cookies,tabs', 0, 0, 0, '-', '-', NOW_MS)
                self.assertEqual(out['error'], '')
                result = out['result']
                self.assertEqual(result['failed'], [])
                self.assertEqual(sorted(links(result['bookmarks'])), ['https://developer.mozilla.org/', 'https://www.mozilla.org/'])
                self.assertEqual([(h['url'], h['visits'], h['typedCount']) for h in result['history']],
                                 [('https://www.mozilla.org/', 3, 1), ('https://developer.mozilla.org/', 1, 0)])
                cookies = {c['name']: c for c in out['cookies']}
                self.assertEqual(sorted(cookies), ['lax', 'plain', 'strict'])
                self.assertEqual({name: c['sameSite'] for name, c in cookies.items()}, {'plain': 'unspecified', 'lax': 'lax', 'strict': 'strict'})
                self.assertEqual(cookies['plain']['expires'], NOW_MS + 3600000)
                self.assertTrue(cookies['strict']['httpOnly'])
                self.assertEqual([t['url'] for t in result['tabs']], ['http://localhost:18766/one', 'http://127.0.0.1:18766/two'])

    def test_real_firefox_and_chromium_schemas_open_and_answer_every_reader_query(self):
        queries = {
            'chromium-155-History.sql': ["SELECT url, title, visit_count, last_visit_time, typed_count FROM urls WHERE hidden = 0 AND last_visit_time > 0 AND (url LIKE 'http://%' OR url LIKE 'https://%') ORDER BY last_visit_time DESC"],
            'chromium-155-Login-Data.sql': ['SELECT * FROM logins'],
            'chromium-155-Web-Data.sql': ['SELECT guid FROM addresses ORDER BY rowid', 'SELECT guid, type, value FROM address_type_tokens', 'SELECT * FROM credit_cards'],
            'chromium-155-Cookies.sql': ["SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'version'", 'SELECT * FROM cookies'],
            'chromium-155-Favicons.sql': ['SELECT icon_mapping.page_url, favicon_bitmaps.id, favicons.url, favicon_bitmaps.width FROM icon_mapping JOIN favicons ON favicons.id = icon_mapping.icon_id JOIN favicon_bitmaps ON favicon_bitmaps.icon_id = favicons.id WHERE favicons.icon_type = 1 AND length(favicon_bitmaps.image_data) BETWEEN 1 AND 16384'],
        }
        for version in FIREFOX:
            queries[f'firefox-{version}-places.sql'] = [
                'SELECT b.id, b.type, b.parent, b.title, p.url, b.dateAdded, b.guid FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id ORDER BY b.parent, b.position',
                "SELECT url, title, visit_count, last_visit_date, typed FROM moz_places WHERE hidden = 0 AND visit_count > 0 AND last_visit_date IS NOT NULL AND (url LIKE 'http://%' OR url LIKE 'https://%') ORDER BY last_visit_date DESC"]
            queries[f'firefox-{version}-cookies.sql'] = ['SELECT * FROM moz_cookies']
            queries[f'firefox-{version}-favicons.sql'] = ['SELECT moz_pages_w_icons.page_url, moz_icons.id, moz_icons.icon_url, moz_icons.width FROM moz_pages_w_icons JOIN moz_icons_to_pages ON moz_icons_to_pages.page_id = moz_pages_w_icons.id JOIN moz_icons ON moz_icons.id = moz_icons_to_pages.icon_id WHERE length(moz_icons.data) BETWEEN 1 AND 16384']
            queries[f'firefox-{version}-key4.sql'] = ["SELECT item1, item2 FROM metaData WHERE id = 'password'", 'SELECT * FROM nssPrivate']
        self.assertEqual(sorted(queries), sorted(path.name for path in PROFILES.glob('*.sql')))
        for schema, statements in queries.items():
            database = self.root / schema.replace('.sql', '.sqlite')
            create(database, schema, wal=schema.endswith('places.sql')).close()
            results = self.probe_sql(database, 'SELECT count(*) FROM sqlite_master', *statements)
            self.assertTrue(all(r['ok'] for r in results), (schema, results))


if __name__ == '__main__':
    unittest.main()
