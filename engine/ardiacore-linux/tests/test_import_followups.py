import ctypes
import ctypes.util
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest

from test_import import FIXTURES, LINUX, ImportFixture, basic_key, make_logins, tree_digests, webkit

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
NOW_MS = 1700000000000
CHROME_SECRET = secrets.token_urlsafe(24)


def keyring_key(secret=CHROME_SECRET):
    return hashlib.pbkdf2_hmac('sha1', secret.encode(), b'saltysalt', 1, 16)


def aes_cbc(key, data, prefix=b'v10', mode='aes-128-cbc', iv='20' * 16, pad=True):
    args = ['openssl', 'enc', f'-{mode}', '-K', key.hex(), '-iv', iv, '-nosalt'] + ([] if pad else ['-nopad'])
    return prefix + subprocess.run(args, input=data, capture_output=True, timeout=30, check=True).stdout


def v11(value, key=None):
    return aes_cbc(key or keyring_key(), value.encode() if isinstance(value, str) else value, b'v11')


def run_keyring(test, config, *args):
    if not shutil.which('dbus-run-session'):
        test.skipTest('dbus-run-session is unavailable')
    try:
        import gi
        gi.require_version('Gio', '2.0')
    except (ImportError, ValueError):
        test.skipTest('PyGObject is unavailable')
    with tempfile.TemporaryDirectory(prefix='ardia-keyring-bus-') as directory:
        scratch = pathlib.Path(directory)
        services = scratch / 'services'
        services.mkdir()
        (scratch / 'session.conf').write_text(f'''<busconfig><type>session</type><listen>unix:tmpdir={scratch}</listen>
<servicedir>{services}</servicedir><policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>''')
        result = subprocess.run(['dbus-run-session', f'--config-file={scratch / "session.conf"}', '--', sys.executable, '-I',
                                 str(FIXTURES / 'fake_keyring.py'), json.dumps(config), *[str(a) for a in args]],
                                capture_output=True, text=True, timeout=120)
    test.assertEqual(result.returncode, 0, result.stderr)
    wrapped = json.loads(result.stdout.strip().splitlines()[-1])
    test.assertEqual(wrapped['code'], 0, wrapped['stderr'])
    return json.loads(wrapped['output']), wrapped['calls']


def pickle(*parts):
    body = b''.join(parts)
    return struct.pack('<I', len(body)) + body


def p_string(text):
    raw = text.encode()
    return struct.pack('<i', len(raw)) + raw + b'\0' * ((4 - len(raw) % 4) % 4)


def p_string16(text):
    raw = text.encode('utf-16-le')
    return struct.pack('<i', len(raw) // 2) + raw + b'\0' * ((4 - len(raw) % 4) % 4)


def snss_commands():
    group_high, group_low = 0x1122334455667788, 0x99AABBCCDDEEFF00
    return [
        (9, struct.pack('<ii', 1, 0)),
        (0, struct.pack('<ii', 1, 10)), (2, struct.pack('<ii', 10, 1)),
        (6, pickle(struct.pack('<ii', 10, 0), p_string('https://old.example/'), p_string16('Old'))),
        (6, pickle(struct.pack('<ii', 10, 1), p_string('https://tab-b.example/'), p_string16('Tab B ✓'))),
        (7, struct.pack('<ii', 10, 1)),
        (25, struct.pack('<ii', 10, 0) + struct.pack('<QQB', group_high, group_low, 1)),
        (27, pickle(struct.pack('<QQ', group_high, group_low), p_string16('Work'), struct.pack('<Ii', 4, 1))),
        (0, struct.pack('<ii', 1, 11)), (2, struct.pack('<ii', 11, 0)),
        (6, pickle(struct.pack('<ii', 11, 0), p_string('https://tab-a.example/'), p_string16('Tab A'))),
        (12, struct.pack('<iB', 11, 1)),
        (21, struct.pack('<ii', 11, 0) + struct.pack('<q', webkit(1690000000000))),
        (8, struct.pack('<ii', 1, 1)),
        (0, struct.pack('<ii', 1, 12)),
        (6, pickle(struct.pack('<ii', 12, 0), p_string('https://closed.example/'), p_string16('Closed'))),
        (16, struct.pack('<i', 12)),
        (9, struct.pack('<ii', 2, 1)), (0, struct.pack('<ii', 2, 13)),
        (6, pickle(struct.pack('<ii', 13, 0), p_string('https://popup.example/'), p_string16('Popup'))),
        (255, b''),
    ]


def snss_v3():
    out = b'SNSS' + struct.pack('<I', 3)
    for command, payload in snss_commands():
        out += struct.pack('<H', 1 + len(payload)) + bytes([command]) + payload
    return out


def snss_v5(key):
    out = b'SNSS' + struct.pack('<I', 5)
    for command, payload in snss_commands():
        blob = aes_cbc(key, bytes([command]) + payload, b'v11')
        out += struct.pack('<I', len(blob)) + blob
    return out


def mozlz4(data):
    library = ctypes.util.find_library('lz4')
    if not library:
        return None
    lz4 = ctypes.CDLL(library)
    bound = lz4.LZ4_compressBound(len(data))
    out = ctypes.create_string_buffer(bound)
    size = lz4.LZ4_compress_default(data, out, len(data), bound)
    assert size > 0
    return b'mozLz40\0' + struct.pack('<I', len(data)) + out.raw[:size]


def der(tag, content):
    length = len(content)
    if length < 0x80:
        head = bytes([length])
    else:
        raw = length.to_bytes((length.bit_length() + 7) // 8, 'big')
        head = bytes([0x80 | len(raw)]) + raw
    return bytes([tag]) + head + content


def oid(text):
    parts = [int(p) for p in text.split('.')]
    out = bytes([parts[0] * 40 + parts[1]])
    for part in parts[2:]:
        chunk = [part & 0x7f]
        part >>= 7
        while part:
            chunk.insert(0, 0x80 | (part & 0x7f))
            part >>= 7
        out += bytes(chunk)
    return der(0x06, out)


def legacy_pbe(global_salt, password, entry_salt, plain):
    hp = hashlib.sha1(global_salt + password).digest()
    pes = entry_salt + b'\0' * (20 - len(entry_salt))
    chp = hashlib.sha1(hp + entry_salt).digest()
    import hmac
    k1 = hmac.new(chp, pes + entry_salt, hashlib.sha1).digest()
    tk = hmac.new(chp, pes, hashlib.sha1).digest()
    k2 = hmac.new(chp, tk + entry_salt, hashlib.sha1).digest()
    k = k1 + k2
    pad = 8 - len(plain) % 8
    cipher = aes_cbc(k[:24], plain + bytes([pad]) * pad, b'', 'des-ede3-cbc', k[-8:].hex(), pad=False)
    algorithm = der(0x30, oid('1.2.840.113549.1.12.5.1.3') + der(0x30, der(0x04, entry_salt) + der(0x02, b'\x01')))
    return der(0x30, algorithm + der(0x04, cipher))


CKA_ID = b'\xf8' + b'\0' * 14 + b'\x01'


def sdr_3des(key, text, key_id=CKA_ID):
    iv = b'\x01\x02\x03\x04\x05\x06\x07\x08'
    cipher = aes_cbc(key[:24], text.encode(), b'', 'des-ede3-cbc', iv.hex())
    import base64
    return base64.b64encode(der(0x30, der(0x04, key_id) +
                                der(0x30, oid('1.2.840.113549.3.7') + der(0x04, iv)) + der(0x04, cipher))).decode()


def sdr_aes(key, text, key_id):
    iv = bytes(range(16))
    cipher = aes_cbc(key[:32], text.encode(), b'', 'aes-256-cbc', iv.hex())
    import base64
    return base64.b64encode(der(0x30, der(0x04, key_id) +
                                der(0x30, oid('2.16.840.1.101.3.4.1.42') + der(0x04, iv)) + der(0x04, cipher))).decode()


class SecretStoreTests(ImportFixture):
    def test_vault_unlocked_keys_leak_gate_and_helpers(self):
        self.assertIn('secret units passed', self.run_binary('secrets'))


class KeyringTests(ImportFixture):
    def chrome_with_keyring_logins(self):
        default = self.chrome_profile('Default')
        make_logins(default / 'Login Data', [
            ('https://ring.example/login', '', 'ringo', v11('keyring pass'), 'https://ring.example/', webkit(1600000000000), 0, 2, 0),
            ('https://basic.example/', '', 'basic', aes_cbc(basic_key(), b'basic pass'), 'https://basic.example/', webkit(1600000000000), 0, 0, 0),
        ])
        return default

    def test_v11_passwords_need_the_keyring_key_and_decrypt_with_it(self):
        self.chrome_with_keyring_logins()
        locked = self.json('read', *self.env_args(), 'chrome', 'Default', 'passwords', 0, 0, 0)
        self.assertEqual([c['username'] for c in locked['credentials']], ['basic'])
        self.assertIn(('passwords', 'locked', "1 password protected by the system keyring wasn't imported"),
                      [(w['kind'], w['code'], w['message']) for w in locked['result']['warnings']])
        unlocked = self.json('read', *self.env_args(), 'chrome', 'Default', 'passwords', 0, 0, 0, keyring_key().hex())
        self.assertEqual(sorted((c['username'], c['password']) for c in unlocked['credentials']),
                         [('basic', 'basic pass'), ('ringo', 'keyring pass')])
        self.assertEqual(unlocked['result']['warnings'], [])
        self.assertNotIn('keyring pass', json.dumps(unlocked['result']))
        wrong = self.json('read', *self.env_args(), 'chrome', 'Default', 'passwords', 0, 0, 0, keyring_key('other').hex())
        self.assertEqual([c['username'] for c in wrong['credentials']], ['basic'])
        self.assertIn('undecryptable', [w['code'] for w in wrong['result']['warnings']])

    def test_secret_service_and_kwallet_lookups_cover_unlocked_locked_denied_missing_and_absent(self):
        chrome_item = {'attributes': {'application': 'chrome', 'xdg:schema': 'chrome_libsecret_os_crypt_password_v2'}, 'secret': CHROME_SECRET}
        reply, calls = run_keyring(self, {'items': [chrome_item]}, self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual((reply['status'], reply['backend'], reply['key']), ('ok', 'secretService', keyring_key().hex()))
        self.assertEqual(calls, ['SearchItems', 'OpenSession', 'GetSecrets', 'Close'])
        reply, calls = run_keyring(self, {'locked': True, 'prompt': 'accept', 'items': [chrome_item]}, self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual(reply['status'], 'ok')
        self.assertIn('Prompt', calls)
        reply, calls = run_keyring(self, {'locked': True, 'prompt': 'dismiss', 'items': [chrome_item]}, self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual((reply['status'], reply['code'], reply['secret']), ('denied', 'denied', ''))
        self.assertNotIn('GetSecrets', calls)
        reply, calls = run_keyring(self, {'locked': True, 'prompt': 'never', 'items': [chrome_item]}, self.binary, 'keyring', 'chrome', 'read', 1500)
        self.assertEqual(reply['status'], 'denied')
        self.assertEqual(calls[-1], 'Dismiss')
        reply, calls = run_keyring(self, {'locked': True, 'items': [chrome_item]}, self.binary, 'keyring', 'chrome', 'exists', 5000)
        self.assertEqual(reply['status'], 'ok')
        self.assertNotIn('Unlock', calls)
        self.assertNotIn('GetSecrets', calls)
        reply, _ = run_keyring(self, {'items': [chrome_item]}, self.binary, 'keyring', 'brave', 'read', 5000)
        self.assertEqual((reply['status'], reply['code'], reply['application']), ('missing', 'notFound', 'brave'))
        wallet = {'secretService': False, 'kwallet': {'folder': 'Chrome Keys', 'key': 'Chrome Safe Storage', 'secret': CHROME_SECRET}}
        reply, calls = run_keyring(self, wallet, self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual((reply['status'], reply['backend'], reply['key']), ('ok', 'kwallet', keyring_key().hex()))
        self.assertEqual(calls, ['isEnabled', 'networkWallet', 'keyDoesNotExist', 'open', 'readPassword', 'close'])
        reply, calls = run_keyring(self, dict(wallet, kwallet=dict(wallet['kwallet'], handle=-1)), self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual(reply['status'], 'denied')
        reply, calls = run_keyring(self, wallet, self.binary, 'keyring', 'chrome', 'exists', 5000)
        self.assertEqual(reply['status'], 'ok')
        self.assertNotIn('open', calls)
        reply, calls = run_keyring(self, {'secretService': False}, self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual((reply['status'], calls), ('unavailable', []))

    def test_discovery_marks_only_browsers_with_a_safe_storage_item(self):
        self.chrome_with_keyring_logins()
        brave = self.chrome_profile('Default', 'BraveSoftware/Brave-Browser')
        (brave / 'History').write_bytes(b'')
        item = {'attributes': {'application': 'chrome'}, 'secret': CHROME_SECRET}
        sources, calls = run_keyring(self, {'locked': True, 'items': [item]}, self.binary, 'discover-keyring', *self.env_args())
        flags = {s['id']: (s['needsKeychain'], s.get('keychainService')) for s in sources}
        self.assertEqual(flags, {'chrome': (True, 'Chrome Safe Storage'), 'brave': (False, None)})
        self.assertNotIn('Unlock', calls)
        self.assertNotIn('GetSecrets', calls)
        self.assertEqual([s['needsKeychain'] for s in self.json('discover', *self.env_args())], [False, False])


class FirefoxLoginTests(ImportFixture):
    def nss_profile(self, name, password):
        if not shutil.which('certutil') or not ctypes.util.find_library('nss3'):
            self.skipTest('NSS tools are unavailable')
        root = self.home / '.mozilla' / 'firefox'
        profile = root / name
        profile.mkdir(parents=True)
        rows = [{'hostname': 'https://ff.example', 'username': 'alice', 'password': 'firefox pass', 'formSubmitURL': 'https://ff.example/login'},
                {'hostname': 'https://two.example', 'username': '', 'password': 'second pass', 'httpRealm': 'Members'},
                {'hostname': 'chrome://FirefoxAccounts', 'username': 'sync', 'password': 'skipped'}]
        result = subprocess.run([sys.executable, '-I', str(FIXTURES / 'nss_logins.py'), str(profile), password, json.dumps(rows)],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        ini = root / 'profiles.ini'
        existing = ini.read_text() if ini.exists() else ''
        index = existing.count('[Profile')
        ini.write_text(existing + f'[Profile{index}]\nName={name}\nIsRelative=1\nPath={name}\n\n')
        return profile

    def read_firefox(self, profile, password='-'):
        return self.json('read', *self.env_args(), 'firefox', profile, 'passwords', 0, 0, 0, '-', password)

    def test_nss_profiles_without_and_with_a_primary_password(self):
        self.nss_profile('plain.default', '')
        self.nss_profile('locked.default', 'primary pw')
        before = tree_digests(self.home)
        plain = self.read_firefox('plain.default')
        self.assertEqual(sorted((c['url'], c['username'], c['password'], c.get('realm')) for c in plain['credentials']), [
            ('https://ff.example/login', 'alice', 'firefox pass', 'https://ff.example'),
            ('https://two.example', '', 'second pass', 'Members'),
        ])
        self.assertEqual(plain['credentials'][0]['created'], 1600000000000)
        self.assertEqual(plain['result']['failed'], [])
        self.assertNotIn('firefox pass', json.dumps(plain['result']))
        for attempt in ['-', 'wrong']:
            locked = self.read_firefox('locked.default', attempt)
            self.assertEqual(locked['credentials'], [])
            self.assertEqual(locked['result']['failed'], ['passwords'])
            self.assertEqual(locked['result']['warnings'][0]['code'], 'locked')
        opened = self.read_firefox('locked.default', 'primary pw')
        self.assertEqual(sorted(c['password'] for c in opened['credentials']), ['firefox pass', 'second pass'])
        self.assertEqual(tree_digests(self.home), before)
        self.assertEqual(list(self.temp.iterdir()), [])
        discovered = self.json('discover', *self.env_args())
        self.assertEqual([p['available'] for p in discovered[0]['profiles']], [['passwords'], ['passwords']])

    def test_legacy_3des_key_database_and_fields(self):
        profile = self.home / '.mozilla' / 'firefox' / 'legacy.default'
        profile.mkdir(parents=True)
        (profile.parent / 'profiles.ini').write_text('[Profile0]\nName=legacy\nIsRelative=1\nPath=legacy.default\n')
        global_salt = bytes(range(20))
        master = bytes(range(100, 124))
        db = sqlite3.connect(profile / 'key4.db')
        db.execute('CREATE TABLE metaData (id PRIMARY KEY UNIQUE ON CONFLICT REPLACE, item1, item2)')
        db.execute('CREATE TABLE nssPrivate (id PRIMARY KEY UNIQUE ON CONFLICT ABORT, a11, a102, a3)')
        db.execute('INSERT INTO metaData VALUES (?,?,?)', ('password', global_salt, legacy_pbe(global_salt, b'', b'e' * 20, b'password-check')))
        db.execute('INSERT INTO nssPrivate VALUES (?,?,?,?)', (1, legacy_pbe(global_salt, b'', b'k' * 20, master), b'\xf8' + b'\0' * 14 + b'\x01', b''))
        db.commit()
        db.close()
        (profile / 'logins.json').write_text(json.dumps({'logins': [
            {'hostname': 'https://legacy.example', 'encryptedUsername': sdr_3des(master, 'lee'), 'encryptedPassword': sdr_3des(master, 'legacy pass')},
            {'hostname': 'https://broken.example', 'encryptedUsername': sdr_3des(master, 'x'), 'encryptedPassword': 'bm90IGRlcg=='},
        ]}))
        out = self.read_firefox('legacy.default')
        self.assertEqual([(c['username'], c['password']) for c in out['credentials']], [('lee', 'legacy pass')])
        self.assertEqual([w['code'] for w in out['result']['warnings']], ['undecryptable'])
        self.assertEqual(self.run_binary('firefoxfield', sdr_3des(master, 'direct'), master.hex()).strip(), 'ok direct')
        self.assertEqual(self.run_binary('firefoxfield', sdr_3des(master, 'direct'), bytes(24).hex()).strip(), 'failed')


class ReviewFixTests(ImportFixture):
    def test_common_cookie_values_inside_history_and_titles_do_not_withhold_the_import(self):
        default = self.chrome_profile('Default')
        db = sqlite3.connect(default / 'Cookies')
        db.execute('CREATE TABLE cookies(creation_utc INTEGER, host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, last_access_utc INTEGER, has_expires INTEGER, is_persistent INTEGER, priority INTEGER, samesite INTEGER)')
        db.executemany('INSERT INTO cookies VALUES (0, ?, ?, ?, ?, "/", 0, 0, 0, 0, 0, 0, 1, -1)', [
            ('lang.example', 'lang', 'en-US', b''), ('theme.example', 'theme', 'dark', b''), ('flag.example', 'ok', 'true', b''),
            ('long.example', 'pref', 'settings-v2', b'')])
        db.commit()
        db.close()
        history = sqlite3.connect(default / 'History')
        history.execute('CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)')
        history.executemany('INSERT INTO urls(url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?,?,1,0,?,0)', [
            ('https://docs.example/en-US/dark/true', 'true', webkit(1700000000000)),
            ('https://app.example/settings-v2/page', 'dark', webkit(1700000000001))])
        history.commit()
        history.close()
        out = self.json('read', *self.env_args(), 'chrome', 'Default', 'history,cookies', 0, 0, 0, '-', '-', NOW_MS)
        self.assertEqual(len(out['cookies']), 4)
        self.assertEqual(out['result']['historyCount'], 2)
        self.assertFalse(out['withheld'])

    def test_firefox_cross_site_partition_keys_are_kept_not_skipped(self):
        profile = self.home / '.mozilla' / 'firefox' / 'p.default'
        profile.mkdir(parents=True)
        (profile.parent / 'profiles.ini').write_text('[Profile0]\nName=p\nIsRelative=1\nPath=p.default\n')
        db = sqlite3.connect(profile / 'cookies.sqlite')
        db.execute("CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0)")
        db.executemany("INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly) VALUES (?, ?, 'v', 'embed.example', '/', 0, 0, 0, 1, 0)", [
            ('^partitionKey=%28https%2Ctop.example%2Cf%29', 'cross'),
            ('^partitionKey=%28https%2Ctop.example%2C8443%2Cf%29', 'cross-port'),
            ('^partitionKey=%28https%2Ctop.example%29', 'same')])
        db.commit()
        db.close()
        out = self.json('read', *self.env_args(), 'firefox', 'p.default', 'cookies', 0, 0, 0, '-', '-', NOW_MS)
        cookies = {c['name']: (c['partition'], c['crossSite']) for c in out['cookies']}
        self.assertEqual(cookies, {'cross': ('https://top.example', True), 'cross-port': ('https://top.example', True),
                                   'same': ('https://top.example', False)})
        self.assertEqual(out['result']['warnings'], [])

    def test_each_firefox_field_uses_the_key_its_key_id_names(self):
        profile = self.home / '.mozilla' / 'firefox' / 'mixed.default'
        profile.mkdir(parents=True)
        (profile.parent / 'profiles.ini').write_text('[Profile0]\nName=mixed\nIsRelative=1\nPath=mixed.default\n')
        global_salt = bytes(range(20))
        legacy_key = bytes(range(100, 124))
        aes_key = bytes(range(200, 232))
        legacy_id = b'\x01' * 16
        db = sqlite3.connect(profile / 'key4.db')
        db.execute('CREATE TABLE metaData (id PRIMARY KEY UNIQUE ON CONFLICT REPLACE, item1, item2)')
        db.execute('CREATE TABLE nssPrivate (id PRIMARY KEY UNIQUE ON CONFLICT ABORT, a11, a102, a3)')
        db.execute('INSERT INTO metaData VALUES (?,?,?)', ('password', global_salt, legacy_pbe(global_salt, b'', b'e' * 20, b'password-check')))
        db.execute('INSERT INTO nssPrivate VALUES (?,?,?,?)', (1, legacy_pbe(global_salt, b'', b'k' * 20, legacy_key), legacy_id, b''))
        db.execute('INSERT INTO nssPrivate VALUES (?,?,?,?)', (2, legacy_pbe(global_salt, b'', b'm' * 20, aes_key), CKA_ID, b''))
        db.commit()
        db.close()
        (profile / 'logins.json').write_text(json.dumps({'logins': [
            {'hostname': 'https://old.example', 'encryptedUsername': sdr_3des(legacy_key, 'old user', legacy_id),
             'encryptedPassword': sdr_3des(legacy_key, 'old pass', legacy_id)},
            {'hostname': 'https://new.example', 'encryptedUsername': sdr_aes(aes_key, 'new user', CKA_ID),
             'encryptedPassword': sdr_aes(aes_key, 'new pass', CKA_ID)},
        ]}))
        out = self.json('read', *self.env_args(), 'firefox', 'mixed.default', 'passwords', 0, 0, 0, '-', '-')
        self.assertEqual(sorted((c['username'], c['password']) for c in out['credentials']), [('new user', 'new pass'), ('old user', 'old pass')])
        self.assertEqual(out['result']['warnings'], [])

    def test_sessions_skip_urls_that_are_not_utf8(self):
        default = self.chrome_profile('Default')
        (default / 'Sessions').mkdir()
        header = b'SNSS' + struct.pack('<I', 3)
        commands = [(9, struct.pack('<ii', 1, 0)), (0, struct.pack('<ii', 1, 1)),
                    (6, pickle(struct.pack('<ii', 1, 0), struct.pack('<i', 5) + b'ht\xfftp' + b'\0' * 3, p_string16('Bad'))),
                    (0, struct.pack('<ii', 1, 2)), (2, struct.pack('<ii', 2, 1)),
                    (6, pickle(struct.pack('<ii', 2, 0), p_string('https://good.example/'), p_string16('Good'))), (255, b'')]
        data = header + b''.join(struct.pack('<H', 1 + len(p)) + bytes([c]) + p for c, p in commands)
        (default / 'Sessions' / 'Session_13300000000000000').write_bytes(data)
        self.assertEqual([t['url'] for t in self.read('chrome', 'Default', ['tabs'])['result']['tabs']], ['https://good.example/'])


class ActivationTests(ImportFixture):
    def run_activated(self, config, *args):
        if not shutil.which('dbus-run-session'):
            self.skipTest('dbus-run-session is unavailable')
        scratch = self.root / 'bus'
        services = scratch / 'services'
        services.mkdir(parents=True, exist_ok=True)
        (scratch / 'config.json').write_text(json.dumps(config))
        log = scratch / 'calls.log'
        (services / 'org.freedesktop.secrets.service').write_text(
            f'[D-BUS Service]\nName=org.freedesktop.secrets\nExec={sys.executable} -I {FIXTURES / "fake_keyring.py"} @{scratch / "config.json"} --serve\n')
        (scratch / 'session.conf').write_text(f'''<busconfig><type>session</type><listen>unix:tmpdir={scratch}</listen>
<servicedir>{services}</servicedir><policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>''')
        result = subprocess.run(['dbus-run-session', f'--config-file={scratch / "session.conf"}', '--', str(self.binary), *[str(a) for a in args]],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_the_consented_read_starts_an_activatable_keyring_but_the_probe_never_does(self):
        try:
            import gi
            gi.require_version('Gio', '2.0')
        except (ImportError, ValueError):
            self.skipTest('PyGObject is unavailable')
        item = {'attributes': {'application': 'chrome'}, 'secret': CHROME_SECRET}
        self.assertEqual(self.run_activated({'items': [item]}, 'keyring', 'chrome', 'exists', 5000)['status'], 'unavailable')
        read = self.run_activated({'items': [item]}, 'keyring', 'chrome', 'read', 10000)
        self.assertEqual((read['status'], read['key']), ('ok', keyring_key().hex()))

    def test_a_prompt_that_fails_to_start_is_unavailable_not_denied(self):
        item = {'attributes': {'application': 'chrome'}, 'secret': CHROME_SECRET}
        reply, calls = run_keyring(self, {'locked': True, 'prompt': 'fail', 'items': [item]}, self.binary, 'keyring', 'chrome', 'read', 5000)
        self.assertEqual(reply['status'], 'unavailable')
        self.assertNotIn('Dismiss', calls)


class TabTests(ImportFixture):
    def test_chromium_cleartext_and_encrypted_sessions(self):
        default = self.chrome_profile('Default')
        sessions = default / 'Sessions'
        sessions.mkdir()
        (sessions / 'Session_13300000000000000').write_bytes(snss_v3())
        out = self.read('chrome', 'Default', ['tabs'])
        result = out['result']
        self.assertEqual([(t['url'], t['title'], t['pinned'], t['windowIndex'], t['active']) for t in result['tabs']], [
            ('https://tab-a.example/', 'Tab A', True, 0, False),
            ('https://tab-b.example/', 'Tab B ✓', False, 0, True),
        ])
        self.assertEqual(result['tabs'][0]['lastActive'], 1690000000000)
        self.assertEqual(result['tabs'][1]['groupId'], '112233445566778899AABBCCDDEEFF00')
        self.assertEqual(result['tabGroups'], [{'id': '112233445566778899AABBCCDDEEFF00', 'title': 'Work', 'color': 'green', 'collapsed': True}])
        self.assertEqual(out['progress'][-1], {'kind': 'tabs', 'phase': 'end', 'processed': 2, 'total': 2})
        listed = self.json('discover', *self.env_args())[0]['profiles'][0]
        self.assertIn('tabs', listed['available'])
        self.assertNotIn('tabsNeedKey', listed)

        encrypted = default / 'Sessions_Encrypted'
        encrypted.mkdir()
        (encrypted / 'Session_13300000000000001').write_bytes(snss_v5(keyring_key()))
        (sessions / 'Session_13300000000000000').write_bytes(snss_v3()[:-3])
        self.assertTrue(self.json('discover', *self.env_args())[0]['profiles'][0]['tabsNeedKey'])
        locked = self.read('chrome', 'Default', ['tabs'])['result']
        self.assertEqual((locked['tabs'], locked['failed']), ([], ['tabs']))
        unlocked = self.json('read', *self.env_args(), 'chrome', 'Default', 'tabs', 0, 0, 0, keyring_key().hex())['result']
        self.assertEqual([t['url'] for t in unlocked['tabs']], ['https://tab-a.example/', 'https://tab-b.example/'])

    def test_firefox_session_store(self):
        session = json.dumps({'windows': [
            {'selected': 2, 'tabs': [
                {'entries': [{'url': 'https://one.example/', 'title': 'One'}], 'pinned': True, 'lastAccessed': 1690000000000},
                {'entries': [{'url': 'https://old.example/', 'title': 'Old'}, {'url': 'https://two.example/', 'title': 'Two'}], 'index': 2, 'groupId': 'g1'},
                {'entries': [{'url': 'https://hidden.example/'}], 'hidden': True},
                {'entries': []},
            ], 'groups': [{'id': 'g1', 'name': 'Reading', 'color': 'blue', 'collapsed': False}]},
            {'tabs': [{'entries': [{'url': 'https://three.example/', 'title': 'Three'}]}]},
        ]}).encode()
        compressed = mozlz4(session * 1)
        if compressed is None:
            self.skipTest('liblz4 is unavailable')
        profile = self.home / '.mozilla' / 'firefox' / 'tabs.default'
        (profile / 'sessionstore-backups').mkdir(parents=True)
        (profile.parent / 'profiles.ini').write_text('[Profile0]\nName=tabs\nIsRelative=1\nPath=tabs.default\n')
        (profile / 'sessionstore-backups' / 'recovery.jsonlz4').write_bytes(compressed)
        result = self.read('firefox', 'tabs.default', ['tabs'])['result']
        self.assertEqual([(t['url'], t['title'], t['pinned'], t['windowIndex'], t['active'], t.get('groupId')) for t in result['tabs']], [
            ('https://one.example/', 'One', True, 0, False, None),
            ('https://two.example/', 'Two', False, 0, True, 'g1'),
            ('https://three.example/', 'Three', False, 1, True, None),
        ])
        self.assertEqual(result['tabGroups'], [{'id': 'g1', 'title': 'Reading', 'color': 'blue', 'collapsed': False}])
        repeated = mozlz4(b'abcdefgh' * 5000)
        path = self.root / 'repeat.jsonlz4'
        path.write_bytes(repeated)
        self.assertEqual(self.run_binary('mozlz4', path).strip(), 'ok ' + (b'abcdefgh' * 5000).hex())
        for broken in [repeated[:-5], repeated[:8] + struct.pack('<I', 40001) + repeated[12:], b'notmozlz4' * 4]:
            path.write_bytes(broken)
            self.assertEqual(self.run_binary('mozlz4', path).strip(), 'failed')


class CookieAndAutofillTests(ImportFixture):
    def chrome_cookies(self, default):
        network = default / 'Network'
        network.mkdir()
        db = sqlite3.connect(network / 'Cookies')
        db.execute('CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)')
        db.execute("INSERT INTO meta VALUES ('version', '24')")
        db.execute('CREATE TABLE cookies(creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL, source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL)')

        def hashed(host, value):
            return hashlib.sha256(host.encode()).digest() + value.encode()

        rows = [
            ('.basic.example', '', 'sid', '', aes_cbc(basic_key(), hashed('.basic.example', 'basic cookie')), '/', webkit(NOW_MS + 86400000), 1, 1, 1, 1, 2, 1, 2, 443, 0),
            ('ring.example', '', 'tok', '', v11(hashed('ring.example', 'ring cookie')), '/app', webkit(NOW_MS + 86400000), 1, 0, 1, 1, 1, 2, 2, 443, 0),
            ('plain.example', '', 'p', 'plain cookie', b'', '/', 0, 0, 0, 0, 0, 1, -1, 1, 80, 0),
            ('expired.example', '', 'old', '', aes_cbc(basic_key(), hashed('expired.example', 'gone')), '/', webkit(NOW_MS - 1000), 0, 0, 1, 1, 1, 0, 2, 443, 0),
            ('wronghost.example', '', 'w', '', aes_cbc(basic_key(), hashed('other.example', 'mismatch')), '/', 0, 0, 0, 0, 0, 1, 0, 2, 443, 0),
            ('embed.example', 'https://top.example', 'part', '', aes_cbc(basic_key(), hashed('embed.example', 'partitioned')), '/', 0, 1, 0, 0, 0, 1, 0, 2, 443, 1),
            ('portal.example', '', 'v12', '', b'v12' + os.urandom(32), '/', 0, 0, 0, 0, 0, 1, 0, 2, 443, 0),
        ]
        db.executemany('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       [(webkit(1600000000000), r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], webkit(1650000000000), r[9], r[10], r[11], r[12], r[13], r[14], webkit(1650000000000), 0, r[15]) for r in rows])
        db.commit()
        db.close()

    def chrome_web_data(self, default):
        db = sqlite3.connect(default / 'Web Data')
        db.execute('CREATE TABLE local_addresses (guid VARCHAR PRIMARY KEY, use_count INTEGER)')
        db.execute('CREATE TABLE local_addresses_type_tokens (guid VARCHAR, type INTEGER, value VARCHAR, verification_status INTEGER, observations BLOB)')
        db.execute("INSERT INTO local_addresses VALUES ('a1', 1), ('a2', 1), ('a3', 1)")
        tokens = [('a1', 7, 'Ada Lovelace'), ('a1', 60, 'Engines Ltd'), ('a1', 77, '12 Analytical St'), ('a1', 33, 'London'), ('a1', 35, 'N1'),
                  ('a1', 36, 'gb'), ('a1', 14, '+44 20 0000'), ('a1', 9, 'ada@example.com'),
                  ('a2', 3, 'Grace'), ('a2', 5, 'Hopper'), ('a2', 30, '1 Navy Way'), ('a2', 31, 'Suite 2'), ('a2', 36, 'us'),
                  ('a3', 7, 'Ada Lovelace'), ('a3', 60, 'Engines Ltd'), ('a3', 77, '12 Analytical St'), ('a3', 33, 'London'), ('a3', 35, 'N1'),
                  ('a3', 36, 'GB'), ('a3', 14, '+44 20 0000'), ('a3', 9, 'ada@example.com')]
        db.executemany('INSERT INTO local_addresses_type_tokens VALUES (?,?,?,0,NULL)', tokens)
        db.execute('CREATE TABLE autofill_profiles (guid VARCHAR PRIMARY KEY, company_name VARCHAR, street_address VARCHAR, city VARCHAR, state VARCHAR, zipcode VARCHAR, country_code VARCHAR)')
        db.execute('CREATE TABLE autofill_profile_names (guid VARCHAR, first_name VARCHAR, middle_name VARCHAR, last_name VARCHAR, full_name VARCHAR)')
        db.execute('CREATE TABLE autofill_profile_emails (guid VARCHAR, email VARCHAR)')
        db.execute('CREATE TABLE autofill_profile_phones (guid VARCHAR, number VARCHAR)')
        db.execute("INSERT INTO autofill_profiles VALUES ('l1', 'Old Co', '9 Legacy Rd', 'Paris', '', '75001', 'fr')")
        db.execute("INSERT INTO autofill_profile_names VALUES ('l1', 'Jean', '', 'Dupont', '')")
        db.execute("INSERT INTO autofill_profile_emails VALUES ('l1', 'jean@example.fr')")
        db.execute('CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, nickname VARCHAR)')
        db.executemany('INSERT INTO credit_cards VALUES (?,?,?,?,?,?)', [
            ('c1', 'Ada Lovelace', 4, 2031, aes_cbc(basic_key(), b'4111 1111 1111 1111'), 'Main'),
            ('c2', 'Ring Card', 13, 29, v11('5555555555554444'), ''),
            ('c3', 'Bad', 1, 2030, aes_cbc(basic_key(), b'not a number'), ''),
        ])
        db.commit()
        db.close()

    def test_chromium_cookies_and_autofill_stay_native(self):
        default = self.chrome_profile('Default')
        self.chrome_cookies(default)
        self.chrome_web_data(default)
        listed = self.json('discover', *self.env_args())[0]['profiles'][0]['available']
        self.assertEqual(listed, ['cookies', 'autofill'])
        before = tree_digests(self.home)
        locked = self.json('read', *self.env_args(), 'chrome', 'Default', 'cookies,autofill', 0, 0, 0, '-', '-', NOW_MS)
        self.assertEqual(tree_digests(self.home), before)
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertEqual(sorted(c['name'] for c in locked['cookies']), ['p', 'part', 'sid'])
        codes = [(w['kind'], w['code']) for w in locked['result']['warnings']]
        self.assertIn(('cookies', 'locked'), codes)
        self.assertIn(('autofill', 'locked'), codes)
        self.assertEqual([c['number'] for c in locked['cards']], ['4111 1111 1111 1111'])

        out = self.json('read', *self.env_args(), 'chrome', 'Default', 'cookies,autofill', 0, 0, 0, keyring_key().hex(), '-', NOW_MS)
        cookies = {c['name']: c for c in out['cookies']}
        self.assertEqual(sorted(cookies), ['p', 'part', 'sid', 'tok'])
        self.assertEqual((cookies['sid']['value'], cookies['sid']['domain'], cookies['sid']['secure'], cookies['sid']['httpOnly'],
                          cookies['sid']['sameSite'], cookies['sid']['priority'], cookies['sid']['sourcePort']),
                         ('basic cookie', '.basic.example', True, True, 'lax', 'high', 443))
        self.assertEqual(cookies['sid']['expires'], NOW_MS + 86400000)
        self.assertEqual((cookies['tok']['value'], cookies['tok']['path'], cookies['tok']['sameSite']), ('ring cookie', '/app', 'strict'))
        self.assertEqual((cookies['p']['value'], cookies['p']['expires'], cookies['p']['sameSite']), ('plain cookie', 0, 'unspecified'))
        self.assertEqual(cookies['part']['partition'], 'https://top.example')
        warnings = [(w['kind'], w['code'], w['message']) for w in out['result']['warnings']]
        self.assertIn(('cookies', 'undecryptable', "1 cookie couldn't be decrypted"), warnings)
        self.assertIn(('cookies', 'undecryptable', "1 cookie protected by the desktop portal wasn't imported. The desktop portal gives "
                       "each app its own key, so Ardia can't read Google Chrome's. Sign in to those sites again in Ardia."), warnings)
        self.assertIn(('autofill', 'undecryptable', "1 card couldn't be decrypted"), warnings)
        self.assertFalse(any(code == 'locked' for _, code, _ in warnings))
        result = out['result']
        self.assertEqual((result['cookieCount'], result['addressCount'], result['cardCount']), (4, 3, 2))
        self.assertEqual(result['failed'], [])
        addresses = out['addresses']
        self.assertEqual([a['name'] for a in addresses], ['Ada Lovelace', 'Grace Hopper', 'Jean Dupont'])
        self.assertEqual((addresses[0]['country'], addresses[0]['street'], addresses[0]['organization']), ('GB', '12 Analytical St', 'Engines Ltd'))
        self.assertEqual(addresses[1]['street'], '1 Navy Way\nSuite 2')
        self.assertEqual((addresses[2]['country'], addresses[2]['email']), ('FR', 'jean@example.fr'))
        self.assertEqual(sorted((c['number'], c['expMonth'], c['expYear']) for c in out['cards']),
                         [('4111 1111 1111 1111', 4, 2031), ('5555555555554444', 0, 2029)])
        serialized = json.dumps(result)
        for secret in ['basic cookie', 'ring cookie', 'plain cookie', '4111', '5555555555554444', 'Analytical']:
            self.assertNotIn(secret, serialized)
        payload = json.loads(out['cookiesPayload'])['cookies']
        self.assertEqual(len(payload), 4)
        sid = next(c for c in payload if c['name'] == 'sid')
        self.assertEqual(sid, {'name': 'sid', 'value': 'basic cookie', 'domain': '.basic.example', 'path': '/', 'created': 1600000000000,
                               'expires': NOW_MS + 86400000, 'lastAccess': 1650000000000, 'secure': True, 'httpOnly': True,
                               'sameSite': 'lax', 'priority': 'high', 'sourceScheme': 'secure', 'sourcePort': 443})
        self.assertEqual(next(c for c in payload if c['name'] == 'part')['partitionKey'], {'topLevelSite': 'https://top.example', 'crossSite': True})
        autofill = json.loads(out['autofillPayload'])
        self.assertEqual(sorted(c['number'] for c in autofill['cards']), ['4111111111111111', '5555555555554444'])
        self.assertEqual(autofill['addresses'][0], {'name': 'Ada Lovelace', 'organization': 'Engines Ltd', 'street': '12 Analytical St', 'city': 'London',
                                                    'postalCode': 'N1', 'country': 'GB', 'phone': '+44 20 0000', 'email': 'ada@example.com'})

    def test_firefox_cookies_skip_containers_and_keep_partitions(self):
        profile = self.home / '.mozilla' / 'firefox' / 'c.default'
        profile.mkdir(parents=True)
        (profile.parent / 'profiles.ini').write_text('[Profile0]\nName=c\nIsRelative=1\nPath=c.default\n')
        db = sqlite3.connect(profile / 'cookies.sqlite')
        db.execute('CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT \'\', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0, sameSite INTEGER DEFAULT 0, rawSameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0, isPartitionedAttributeSet INTEGER DEFAULT 0)')
        rows = [('', 'ff', 'firefox cookie', '.ff.example', '/', (NOW_MS // 1000) + 3600, 1650000000000000, 1600000000000000, 1, 1, 1, 1, 2),
                ('^userContextId=2', 'ctx', 'container', 'ctx.example', '/', (NOW_MS // 1000) + 3600, 0, 0, 0, 0, 0, 0, 1),
                ('^privateBrowsingId=1', 'pb', 'private', 'pb.example', '/', (NOW_MS // 1000) + 3600, 0, 0, 0, 0, 0, 0, 1),
                ('^partitionKey=%28https%2Ctop.example%29', 'pk', 'partitioned', 'embed.example', '/', (NOW_MS // 1000) + 3600, 0, 0, 1, 0, 0, 0, 2),
                ('', 'old', 'expired', 'old.example', '/', (NOW_MS // 1000) - 10, 0, 0, 0, 0, 0, 0, 1),
                ('', 'none', 'samesite none', 'none.example', '/', 0, 0, 0, 1, 0, 0, 0, 2)]
        db.executemany('INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, sameSite, rawSameSite, schemeMap) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', rows)
        db.commit()
        db.close()
        self.assertIn('cookies', self.json('discover', *self.env_args())[0]['profiles'][0]['available'])
        out = self.json('read', *self.env_args(), 'firefox', 'c.default', 'cookies', 0, 0, 0, '-', '-', NOW_MS)
        cookies = {c['name']: c for c in out['cookies']}
        self.assertEqual(sorted(cookies), ['ff', 'none', 'pk'])
        self.assertEqual((cookies['ff']['value'], cookies['ff']['expires'], cookies['ff']['sameSite'], cookies['ff']['sourceScheme'], cookies['ff']['created']),
                         ('firefox cookie', (NOW_MS // 1000 + 3600) * 1000, 'lax', 'secure', 1600000000000))
        self.assertEqual(cookies['pk']['partition'], 'https://top.example')
        self.assertEqual(cookies['none']['sameSite'], 'none')
        self.assertEqual([(w['code'], w['message']) for w in out['result']['warnings']],
                         [('skipped', "2 cookies from containers or private windows weren't imported")])
        self.assertNotIn('firefox cookie', json.dumps(out['result']))


class ImportFollowupSourceRules(unittest.TestCase):
    def test_new_import_sources_have_no_comments_and_are_built(self):
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ['ac_linux_import_crypto', 'ac_linux_import_keyring', 'ac_linux_import_secrets', 'ac_linux_import_sessions',
                     'ac_linux_import_storage']:
            for suffix in ['.cc', '.h']:
                path = LINUX / f'{name}{suffix}'
                self.assertIn(f'"{name}{suffix}"', build)
                self.assertIsNone(re.search(r'(^|\s)//(?!\s*nogncheck)|/\*', path.read_text()), path)
        for script in ['fake_keyring.py', 'nss_logins.py']:
            self.assertNotRegex((FIXTURES / script).read_text(), r'(?m)^\s*#')

    def test_service_wiring_for_unlock_vault_and_writes(self):
        service = (LINUX / 'ac_linux_import_service.cc').read_text()
        formats = (LINUX / 'ac_linux_import_formats.h').read_text()
        for method in ['unlockBrowser', 'writeImported', 'discardImported']:
            self.assertIn(f'"ArdiaImport.{method}"', formats)
            self.assertIn(f'"ArdiaImport.{method}"', service)
        self.assertRegex(service, r'kKeyring = \{[^}]*CONTINUE_ON_SHUTDOWN')
        self.assertIn('kKeyring, base::BindOnce(&ReadSafeStorageKey', service)
        run = service[service.index('li::ImportOutcome RunImport('):]
        run = run[:run.index('\n}\n')]
        self.assertIn('li::OutcomeLeaks(outcome)', run)
        self.assertIn('if (outcome.withheld) {', service)
        self.assertNotIn('ReplyLeaksImported(', service)
        answer = service[service.index('  void Answer(bool cookies'):]
        answer = answer[:answer.index('\n  }\n')]
        self.assertNotIn('cookies_ = false', answer)
        self.assertNotIn('autofill_ = false', answer)
        keyring = (LINUX / 'ac_linux_import_keyring.cc').read_text()
        self.assertIn('SecretService secrets(bus, timeout_ms, false);', keyring)
        self.assertIn('KWallet wallet(bus, timeout_ms, false);', keyring)
        self.assertIn('SecretService secrets(bus, kKeyringProbeTimeoutMs, true);', keyring)
        self.assertIn('"ac_cookies_import"', service)
        self.assertIn('"ac_autofill_import"', service)
        closed = service[service.index('void WindowClosed('):]
        self.assertIn('ForgetSecrets(owner);', closed[:closed.index('\n  }\n')])
        forget = service[service.index('void ForgetSecrets('):]
        forget = forget[:forget.index('\n  }\n')]
        for step in ['unlocked_.Forget(owner);', 'imported_.DiscardOwner(owner);', '++secret_generation_']:
            self.assertIn(step, forget)
        unlocked = service[service.index('void Unlocked('):]
        self.assertLess(unlocked.index('generation != SecretGeneration(owner)'), unlocked.index('unlocked_.Set('))

    def test_keyring_access_is_dlopened_and_never_logged(self):
        keyring = (LINUX / 'ac_linux_import_keyring.cc').read_text()
        self.assertIn('dlopen("libgio-2.0.so.0"', keyring)
        self.assertIn('kCallNoAutoStart', keyring)
        for source in ['ac_linux_import_keyring.cc', 'ac_linux_import_secrets.cc', 'ac_linux_import_crypto.cc', 'ac_linux_import_service.cc']:
            self.assertIsNone(re.search(r'\bLOG\(|\bVLOG\(|\bprintf\(|std::cerr', (LINUX / source).read_text()), source)


if __name__ == '__main__':
    unittest.main()
