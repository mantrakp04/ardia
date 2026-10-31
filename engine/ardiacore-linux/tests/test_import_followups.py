import hashlib
import json
import os
import sqlite3
import struct
import unittest

from support import NOW_MS, ImportFixture, aes_cbc, basic_key, keyring_key, make_logins, tree_digests, webkit


def v11(value, key=None):
    return aes_cbc(key or keyring_key(), value.encode() if isinstance(value, str) else value, b'v11')


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

if __name__ == '__main__':
    unittest.main()
