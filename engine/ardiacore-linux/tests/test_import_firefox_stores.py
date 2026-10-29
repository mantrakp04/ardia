import base64
import ctypes
import ctypes.util
import json
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import unittest

from test_import import FIXTURES, LINUX, ImportFixture, make_logins, tree_digests, webkit
from test_import_followups import aes_cbc, keyring_key, run_keyring

LOGINS_KEY = bytes(range(32))
AUTOFILL_KEY = bytes(range(64, 96))
CARD_KEY = bytes(range(200, 216))
PNG = b'\x89PNG\r\n\x1a\n' + b'\0\0\0\rIHDR' + b'icon-bytes'


def libcrypto():
    path = ctypes.util.find_library('crypto')
    if not path:
        raise unittest.SkipTest('libcrypto is unavailable')
    lib = ctypes.CDLL(path)
    lib.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
    lib.EVP_aes_256_gcm.restype = ctypes.c_void_p
    lib.EVP_aes_128_gcm.restype = ctypes.c_void_p
    lib.EVP_EncryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    lib.EVP_EncryptUpdate.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int]
    lib.EVP_EncryptFinal_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
    lib.EVP_CIPHER_CTX_ctrl.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    lib.EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
    return lib


def aes_gcm(key, iv, data, aad=b''):
    lib = libcrypto()
    context = lib.EVP_CIPHER_CTX_new()
    cipher = lib.EVP_aes_256_gcm() if len(key) == 32 else lib.EVP_aes_128_gcm()
    assert lib.EVP_EncryptInit_ex(context, cipher, None, None, None) == 1
    assert lib.EVP_CIPHER_CTX_ctrl(context, 0x9, len(iv), None) == 1
    assert lib.EVP_EncryptInit_ex(context, None, None, key, iv) == 1
    written = ctypes.c_int(0)
    if aad:
        assert lib.EVP_EncryptUpdate(context, None, ctypes.byref(written), aad, len(aad)) == 1
    out = ctypes.create_string_buffer(len(data) + 32)
    assert lib.EVP_EncryptUpdate(context, out, ctypes.byref(written), data, len(data)) == 1
    total = written.value
    assert lib.EVP_EncryptFinal_ex(context, ctypes.byref(out, total), ctypes.byref(written)) == 1
    total += written.value
    tag = ctypes.create_string_buffer(16)
    assert lib.EVP_CIPHER_CTX_ctrl(context, 0x10, 16, tag) == 1
    lib.EVP_CIPHER_CTX_free(context)
    return out.raw[:total], tag.raw


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def jwe(key, text, iv=b'\x07' * 12, header=b'{"alg":"dir","enc":"A256GCM"}'):
    protected = b64url(header)
    cipher, tag = aes_gcm(key, iv, text.encode(), protected.encode())
    return '.'.join([protected, '', b64url(iv), b64url(cipher), b64url(tag)])


def os_key_store(key, text, iv=b'\x05' * 12):
    cipher, tag = aes_gcm(key, iv, text.encode())
    return base64.b64encode(iv + cipher + tag).decode()


class FirefoxStoreFixture(ImportFixture):
    def firefox_profile(self, name, password='', app_keys=None, root='.mozilla/firefox', logins=None):
        if not shutil.which('certutil') or not ctypes.util.find_library('nss3'):
            self.skipTest('NSS tools are unavailable')
        base = self.home / root
        profile = base / name
        profile.mkdir(parents=True)
        if logins is not None:
            made = subprocess.run([sys.executable, '-I', str(FIXTURES / 'nss_logins.py'), str(profile), password, json.dumps(logins)],
                                  capture_output=True, text=True, timeout=120)
            self.assertEqual(made.returncode, 0, made.stderr)
        keys = {label: key.hex() for label, key in (app_keys or {}).items()}
        result = subprocess.run([sys.executable, '-I', str(FIXTURES / 'nss_app_keys.py'), str(profile), password, json.dumps(keys)],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        ini = base / 'profiles.ini'
        existing = ini.read_text() if ini.exists() else ''
        index = existing.count('[Profile')
        ini.write_text(existing + f'[Profile{index}]\nName={name}\nIsRelative=1\nPath={name}\n\n')
        return profile

    def read_firefox(self, profile, kinds, password='-', card_key='-', browser='firefox'):
        return self.json('read', *self.env_args(), browser, profile, ','.join(kinds), 0, 0, 0, '-', password, 1700000000000, card_key)

    def logins_db(self, profile, local, mirror=()):
        db = sqlite3.connect(profile / 'logins.db')
        common = ('id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, httpRealm TEXT, formActionOrigin TEXT, '
                  'usernameField TEXT, passwordField TEXT, timesUsed INTEGER NOT NULL DEFAULT 0, timeCreated INTEGER NOT NULL, '
                  'timeLastUsed INTEGER, timePasswordChanged INTEGER NOT NULL, timeLastBreachAlertDismissed INTEGER, '
                  'secFields TEXT, guid TEXT NOT NULL UNIQUE')
        db.execute(f'CREATE TABLE loginsL ({common}, local_modified INTEGER, is_deleted TINYINT NOT NULL DEFAULT 0, sync_status TINYINT NOT NULL DEFAULT 0)')
        db.execute(f'CREATE TABLE loginsM ({common}, server_modified INTEGER NOT NULL, is_overridden TINYINT NOT NULL DEFAULT 0, enc_unknown_fields TEXT)')
        for row in local:
            db.execute('INSERT INTO loginsL (guid, origin, httpRealm, formActionOrigin, secFields, timeCreated, timeLastUsed, '
                       'timePasswordChanged, timesUsed, is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?)', row)
        for row in mirror:
            db.execute('INSERT INTO loginsM (guid, origin, httpRealm, formActionOrigin, secFields, timeCreated, timeLastUsed, '
                       'timePasswordChanged, timesUsed, server_modified, is_overridden) VALUES (?,?,?,?,?,?,?,?,?,?,?)', row)
        db.commit()
        db.close()

    def sec(self, user, password, key=LOGINS_KEY):
        return jwe(key, json.dumps({'u': user, 'p': password}, separators=(',', ':')))


class FirefoxLoginsDatabaseTests(FirefoxStoreFixture):
    def test_logins_db_imports_with_the_nss_as_logins_key(self):
        profile = self.firefox_profile('rust.default', app_keys={'as-logins-key': LOGINS_KEY})
        self.logins_db(profile, [
            ('g1', 'https://db.example', None, 'https://db.example/login', self.sec('dana', 'db pass'), 1600000000000, 1700000000000, 1600000000000, 3, 0),
            ('g2', 'https://gone.example', None, '', self.sec('old', 'deleted pass'), 1, 1, 1, 0, 1),
            ('g3', 'chrome://FirefoxAccounts', 'Firefox Accounts credentials', None, self.sec('sync', 'skip'), 1, 1, 1, 0, 0),
            ('g4', 'https://realm.example', 'Members', None, self.sec('', 'realm pass'), 1600000000000, 0, 1, 1, 0),
            ('g5', 'https://broken.example', None, '', 'not.a.jwe', 1, 1, 1, 0, 0),
        ], [
            ('g1', 'https://db.example', None, 'https://db.example/login', self.sec('dana', 'stale pass'), 1, 1, 1, 0, 5, 1),
            ('g6', 'https://mirror.example', None, '', self.sec('mo', 'mirror pass'), 1600000000000, 0, 1, 0, 5, 0),
        ])
        before = tree_digests(self.home)
        out = self.read_firefox('rust.default', ['passwords'])
        self.assertEqual(sorted((c['url'], c['username'], c['password'], c.get('realm')) for c in out['credentials']), [
            ('https://db.example/login', 'dana', 'db pass', 'https://db.example'),
            ('https://mirror.example', 'mo', 'mirror pass', 'https://mirror.example'),
            ('https://realm.example', '', 'realm pass', 'Members'),
        ])
        self.assertEqual([w['code'] for w in out['result']['warnings']], ['undecryptable'])
        self.assertEqual(out['result']['failed'], [])
        self.assertFalse(out['withheld'])
        self.assertNotIn('db pass', json.dumps(out['result']))
        self.assertEqual(tree_digests(self.home), before)
        self.assertEqual(list(self.temp.iterdir()), [])
        discovered = self.json('discover', *self.env_args())
        self.assertEqual(discovered[0]['profiles'][0]['available'], ['passwords'])
        self.assertNotIn('needsPrimaryPassword', discovered[0]['profiles'][0])
        self.assertFalse(discovered[0]['needsKeychain'])

    def test_logins_json_and_logins_db_together_import_each_login_once(self):
        profile = self.firefox_profile('both.default', app_keys={'as-logins-key': LOGINS_KEY}, logins=[
            {'hostname': 'https://shared.example', 'username': 'sam', 'password': 'shared pass', 'formSubmitURL': 'https://shared.example/in'},
            {'hostname': 'https://json.example', 'username': 'jo', 'password': 'json pass'},
        ])
        self.logins_db(profile, [
            ('a', 'https://shared.example', None, 'https://shared.example/in', self.sec('sam', 'shared pass'), 1600000000000, 0, 1, 1, 0),
            ('b', 'https://db.example', None, '', self.sec('dee', 'db only'), 1600000000000, 0, 1, 1, 0),
        ])
        out = self.read_firefox('both.default', ['passwords'])
        self.assertEqual(sorted((c['username'], c['password']) for c in out['credentials']),
                         [('dee', 'db only'), ('jo', 'json pass'), ('sam', 'shared pass')])

    def test_a_primary_password_locks_logins_db_until_it_is_given(self):
        profile = self.firefox_profile('locked.default', 'primary pw', {'as-logins-key': LOGINS_KEY})
        self.logins_db(profile, [('g', 'https://db.example', None, '', self.sec('dana', 'db pass'), 1, 0, 1, 0, 0)])
        for attempt in ['-', 'wrong']:
            locked = self.read_firefox('locked.default', ['passwords'], attempt)
            self.assertEqual(locked['credentials'], [])
            self.assertEqual(locked['result']['warnings'][0]['code'], 'locked')
        opened = self.read_firefox('locked.default', ['passwords'], 'primary pw')
        self.assertEqual([c['password'] for c in opened['credentials']], ['db pass'])
        source = self.json('discover', *self.env_args())[0]
        self.assertTrue(source['profiles'][0]['needsPrimaryPassword'])
        self.assertTrue(source['needsKeychain'])

    def test_a_logins_db_whose_key_is_missing_reports_it_and_keeps_logins_json(self):
        profile = self.firefox_profile('nokey.default', logins=[{'hostname': 'https://json.example', 'username': 'jo', 'password': 'json pass'}])
        self.logins_db(profile, [('g', 'https://db.example', None, '', self.sec('dana', 'db pass'), 1, 0, 1, 0, 0)])
        out = self.read_firefox('nokey.default', ['passwords'])
        self.assertEqual([c['password'] for c in out['credentials']], ['json pass'])
        self.assertEqual([(w['code'], 'logins.db' in w['message']) for w in out['result']['warnings']], [('unreadable', True)])


class FirefoxAutofillTests(FirefoxStoreFixture):
    def autofill_db(self, profile, addresses, cards):
        db = sqlite3.connect(profile / 'autofill.db')
        db.execute('CREATE TABLE addresses_data (guid TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, organization TEXT NOT NULL, '
                   'street_address TEXT NOT NULL, address_level3 TEXT NOT NULL, address_level2 TEXT NOT NULL, address_level1 TEXT NOT NULL, '
                   'postal_code TEXT NOT NULL, country TEXT NOT NULL, tel TEXT NOT NULL, email TEXT NOT NULL, time_created INTEGER NOT NULL, '
                   'time_last_used INTEGER NOT NULL, time_last_modified INTEGER NOT NULL, times_used INTEGER NOT NULL, sync_change_counter INTEGER NOT NULL)')
        db.execute('CREATE TABLE credit_cards_data (guid TEXT NOT NULL PRIMARY KEY, cc_name TEXT NOT NULL, cc_number_enc TEXT NOT NULL, '
                   'cc_number_last_4 TEXT NOT NULL, cc_cvv_enc TEXT NOT NULL DEFAULT \'\', cc_exp_month INTEGER, cc_exp_year INTEGER, '
                   'cc_type TEXT NOT NULL, time_created INTEGER NOT NULL, time_last_used INTEGER, time_last_modified INTEGER NOT NULL, '
                   'times_used INTEGER NOT NULL, sync_change_counter INTEGER NOT NULL)')
        for index, row in enumerate(addresses):
            db.execute('INSERT INTO addresses_data VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (f'a{index}', row[0], row[1], row[2], '', row[3], row[4], row[5], row[6], row[7], row[8], index, 0, 0, 0, 0))
        for index, (name, number, month, year) in enumerate(cards):
            db.execute('INSERT INTO credit_cards_data VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (f'c{index}', name, number, '1111', '', month, year, 'visa', index, 0, 0, 0, 0))
        db.commit()
        db.close()

    def test_autofill_db_addresses_and_cards_with_the_nss_as_autofill_key(self):
        profile = self.firefox_profile('af.default', 'primary pw', {'as-autofill-key': AUTOFILL_KEY})
        self.autofill_db(profile, [
            ('Ada Lovelace', 'Analytical', '12 Engine St\nFloor 2', 'London', 'LND', 'N1 9GU', 'gb', '+44 20 7946 0000', 'ada@example.org'),
            ('Ada Lovelace', 'Analytical', '12 Engine St\nFloor 2', 'London', 'LND', 'N1 9GU', 'gb', '+44 20 7946 0000', 'ada@example.org'),
        ], [
            ('Ada L', jwe(AUTOFILL_KEY, '4111111111111111'), 4, 2031),
            ('Bad', jwe(bytes(32), '4000000000000002'), 5, 32),
        ])
        locked = self.read_firefox('af.default', ['autofill'])
        self.assertEqual(len(locked['addresses']), 1)
        self.assertEqual(locked['addresses'][0]['country'], 'GB')
        self.assertEqual(locked['cards'], [])
        self.assertIn(('locked', "Enter Firefox's primary password to import 2 saved cards"),
                      [(w['code'], w['message']) for w in locked['result']['warnings']])
        opened = self.read_firefox('af.default', ['autofill'], 'primary pw')
        self.assertEqual([(c['name'], c['number'], c['expMonth'], c['expYear']) for c in opened['cards']],
                         [('Ada L', '4111111111111111', 4, 2031)])
        self.assertEqual([w['code'] for w in opened['result']['warnings']], ['undecryptable'])
        self.assertEqual((opened['result']['addressCount'], opened['result']['cardCount']), (1, 1))
        self.assertFalse(opened['withheld'])
        self.assertNotIn('4111111111111111', json.dumps(opened['result']))
        self.assertIn('4111111111111111', opened['autofillPayload'])
        profile_flags = self.json('discover', *self.env_args())[0]['profiles'][0]
        self.assertEqual(profile_flags['available'], ['autofill'])
        self.assertTrue(profile_flags['needsPrimaryPassword'])
        self.assertNotIn('cardsNeedKeyring', profile_flags)

    def test_autofill_profiles_json_addresses_and_cards_encrypted_with_the_os_key_store(self):
        profile = self.firefox_profile('json.default')
        (profile / 'autofill-profiles.json').write_text(json.dumps({'version': 1, 'addresses': [
            {'guid': 'x1', 'version': 1, 'given-name': 'Grace', 'family-name': 'Hopper', 'organization': 'Navy',
             'street-address': '1 Cobol Way', 'address-level2': 'Arlington', 'address-level1': 'VA', 'postal-code': '22201',
             'country': 'us', 'tel': '+15555550100', 'email': 'grace@example.org'},
            {'guid': 'x2', 'deleted': True, 'timeLastModified': 1},
        ], 'creditCards': [
            {'guid': 'c1', 'version': 3, 'cc-name': 'Grace Hopper', 'cc-number': '************4242',
             'cc-number-encrypted': os_key_store(CARD_KEY, '4242424242424242'), 'cc-exp-month': 12, 'cc-exp-year': 2030},
            {'guid': 'c2', 'deleted': True},
            {'guid': 'c3', 'version': 3, 'cc-name': 'Wrong Key', 'cc-number-encrypted': os_key_store(bytes(16), '5555555555554444'),
             'cc-exp-month': '1', 'cc-exp-year': '29'},
        ]}))
        locked = self.read_firefox('json.default', ['autofill'])
        self.assertEqual([(a['name'], a['country'], a['street']) for a in locked['addresses']], [('Grace Hopper', 'US', '1 Cobol Way')])
        self.assertEqual(locked['cards'], [])
        self.assertIn('locked', [w['code'] for w in locked['result']['warnings']])
        self.assertIn('system keyring', ' '.join(w['message'] for w in locked['result']['warnings']))
        opened = self.read_firefox('json.default', ['autofill'], card_key=CARD_KEY.hex())
        self.assertEqual([(c['name'], c['number'], c['expMonth'], c['expYear']) for c in opened['cards']],
                         [('Grace Hopper', '4242424242424242', 12, 2030)])
        self.assertEqual([w['code'] for w in opened['result']['warnings']], ['undecryptable'])
        flags = self.json('discover', *self.env_args())[0]
        self.assertTrue(flags['profiles'][0]['cardsNeedKeyring'])
        self.assertFalse(flags['needsKeychain'])

    def unlock_profiles(self):
        locked = self.firefox_profile('locked.default', 'primary pw', {'as-autofill-key': AUTOFILL_KEY})
        self.autofill_db(locked, [], [('Ada', jwe(AUTOFILL_KEY, '4111111111111111'), 1, 2030)])
        cards = self.firefox_profile('cards.default')
        (cards / 'autofill-profiles.json').write_text(json.dumps({'creditCards': [
            {'guid': 'c', 'cc-name': 'G', 'cc-number-encrypted': os_key_store(CARD_KEY, '4242424242424242'), 'cc-exp-month': 1, 'cc-exp-year': 2030}]}))
        return {'attributes': {'string': 'Firefox Encrypted Storage', 'xdg:schema': 'mozilla.firefox'},
                'secret': base64.b64encode(CARD_KEY).decode()}

    def unlock(self, password, profiles, kinds, keyring=None):
        args = ['firefox-unlock', *self.env_args(), 'firefox', password, ','.join(profiles) or '-', ','.join(kinds) or '-']
        if keyring is None:
            return self.json(*args), []
        return run_keyring(self, keyring, self.binary, *args, 'keyring')

    def test_unlocking_firefox_checks_the_primary_password_and_reads_the_card_key_with_consent(self):
        item = self.unlock_profiles()
        both = ['locked.default', 'cards.default']
        wrong, _ = self.unlock('not it', both, ['passwords', 'autofill'])
        self.assertEqual((wrong['code'], wrong['primary']), ('denied', ''))
        self.assertEqual(wrong['message'], "That isn't Firefox's primary password")
        right, _ = self.unlock('primary pw', both, ['passwords', 'autofill'])
        self.assertEqual((right['code'], right['primary'], right['cardKey']), ('', 'primary pw', ''))
        reply, calls = self.unlock('primary pw', both, ['passwords', 'autofill'], {'locked': True, 'prompt': 'accept', 'items': [item]})
        self.assertEqual((reply['code'], reply['primary'], reply['cardKey'], reply['cardsLocked']), ('', 'primary pw', CARD_KEY.hex(), False))
        self.assertIn('Prompt', calls)
        reply, _ = self.unlock('-', ['cards.default'], ['autofill'], {'locked': True, 'prompt': 'dismiss', 'items': [item]})
        self.assertEqual((reply['code'], reply['cardKey']), ('denied', ''))
        reply, _ = self.unlock('primary pw', both, ['passwords', 'autofill'], {'locked': True, 'prompt': 'dismiss', 'items': [item]})
        self.assertEqual((reply['code'], reply['primary'], reply['cardKey'], reply['cardsLocked']), ('', 'primary pw', '', True))
        reply, _ = self.unlock('-', ['cards.default'], ['autofill'], {'items': []})
        self.assertEqual((reply['code'], reply['message']), ('notFound', 'The system keyring has no Firefox Encrypted Storage key'))
        sources, calls = run_keyring(self, {'locked': True, 'items': [item]}, self.binary, 'discover-keyring', *self.env_args())
        self.assertEqual((sources[0]['needsKeychain'], sources[0].get('keychainService')), (True, 'Firefox Encrypted Storage'))
        self.assertNotIn('GetSecrets', calls)
        self.assertNotIn('Unlock', calls)

    def test_the_unlock_reads_the_card_key_only_for_selected_profiles_that_import_autofill(self):
        item = self.unlock_profiles()
        keyring = {'locked': True, 'prompt': 'accept', 'items': [item]}
        for profiles, kinds in [(['locked.default'], ['passwords', 'autofill']), (['locked.default', 'cards.default'], ['passwords']),
                                (['cards.default'], ['cookies'])]:
            reply, calls = self.unlock('primary pw' if 'locked.default' in profiles else '-', profiles, kinds, keyring)
            self.assertEqual((reply['code'], reply['cardKey']), ('', ''), (profiles, kinds))
            self.assertEqual(calls, [], (profiles, kinds))
        reply, calls = self.unlock('-', ['cards.default'], ['autofill'], keyring)
        self.assertEqual((reply['code'], reply['cardKey']), ('', CARD_KEY.hex()))
        self.assertIn('GetSecrets', calls)

    def test_the_primary_password_is_checked_only_against_selected_profiles(self):
        self.unlock_profiles()
        other = self.firefox_profile('other.default', 'other pw', {'as-logins-key': LOGINS_KEY})
        self.logins_db(other, [('g', 'https://db.example', None, '', self.sec('o', 'other db pass'), 1, 0, 1, 0, 0)])
        reply, _ = self.unlock('primary pw', ['other.default'], ['passwords'])
        self.assertEqual((reply['code'], reply['primary']), ('denied', ''))
        reply, _ = self.unlock('other pw', ['other.default'], ['passwords'])
        self.assertEqual((reply['code'], reply['primary']), ('', 'other pw'))
        reply, _ = self.unlock('primary pw', ['cards.default'], ['passwords'])
        self.assertEqual((reply['code'], reply['primary']), ('', ''))

    def test_the_card_key_search_always_names_the_firefox_schema(self):
        item = self.unlock_profiles()
        unschemed = {'attributes': {'string': 'Firefox Encrypted Storage'}, 'secret': item['secret']}
        reply, calls = self.unlock('-', ['cards.default'], ['autofill'], {'items': [unschemed]})
        self.assertEqual((reply['code'], reply['cardKey']), ('notFound', ''))
        self.assertNotIn('GetSecrets', calls)


class ReviewRoundOneTests(FirefoxStoreFixture):
    def test_an_empty_logins_json_beside_logins_db_needs_no_key_and_warns_nothing(self):
        profile = self.firefox_profile('rust.default', app_keys={'as-logins-key': LOGINS_KEY})
        (profile / 'logins.json').write_text(json.dumps({'nextId': 1, 'logins': [], 'version': 3}))
        self.logins_db(profile, [('g', 'https://db.example', None, '', self.sec('dana', 'db pass'), 1, 0, 1, 0, 0)])
        out = self.read_firefox('rust.default', ['passwords'])
        self.assertEqual([c['password'] for c in out['credentials']], ['db pass'])
        self.assertEqual(out['result']['warnings'], [])

    def test_the_newer_of_two_duplicate_logins_wins(self):
        profile = self.firefox_profile('both.default', app_keys={'as-logins-key': LOGINS_KEY}, logins=[
            {'hostname': 'https://shared.example', 'username': 'sam', 'password': 'old pass'}])
        self.logins_db(profile, [('a', 'https://shared.example', None, '', self.sec('sam', 'new pass'), 1600000000000, 1800000000000, 1, 1, 0)])
        out = self.read_firefox('both.default', ['passwords'])
        self.assertEqual([(c['username'], c['password']) for c in out['credentials']], [('sam', 'new pass')])
        profile = self.firefox_profile('older.default', app_keys={'as-logins-key': LOGINS_KEY}, logins=[
            {'hostname': 'https://shared.example', 'username': 'sam', 'password': 'json pass'}])
        self.logins_db(profile, [('a', 'https://shared.example', None, '', self.sec('sam', 'stale db pass'), 1, 2, 1, 1, 0)])
        out = self.read_firefox('older.default', ['passwords'])
        self.assertEqual([c['password'] for c in out['credentials']], ['json pass'])

    def test_huge_expiry_numbers_are_ignored_without_undefined_behaviour(self):
        profile = self.firefox_profile('json.default')
        (profile / 'autofill-profiles.json').write_text(
            '{"creditCards": [{"guid": "c", "cc-name": "Big", "cc-number-encrypted": "%s", "cc-exp-month": 1e300, "cc-exp-year": -1e300}]}'
            % os_key_store(CARD_KEY, '4242424242424242'))
        result = subprocess.run([str(self.binary), 'read', *[str(a) for a in self.env_args()], 'firefox', 'json.default', 'autofill',
                                 '0', '0', '0', '-', '-', '1700000000000', CARD_KEY.hex()], capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('runtime error', result.stderr)
        cards = json.loads(result.stdout)['cards']
        self.assertEqual([(c['number'], c['expMonth'], c['expYear']) for c in cards], [('4242424242424242', 0, 0)])

    def test_an_unreadable_autofill_db_keeps_the_json_store(self):
        profile = self.firefox_profile('json.default')
        (profile / 'autofill-profiles.json').write_text(json.dumps({'addresses': [
            {'guid': 'a', 'name': 'Grace Hopper', 'street-address': '1 Cobol Way', 'country': 'us'}]}))
        (profile / 'autofill.db').write_bytes(b'')
        (profile / 'autofill.db').chmod(0)
        try:
            out = self.read_firefox('json.default', ['autofill'])
        finally:
            (profile / 'autofill.db').chmod(0o600)
        self.assertEqual([a['name'] for a in out['addresses']], ['Grace Hopper'])
        self.assertEqual(out['result']['failed'], [])
        self.assertEqual([(w['code'], 'autofill.db' in w['message']) for w in out['result']['warnings']], [('unreadable', True)])

    def test_decrypted_logins_db_fields_are_wiped(self):
        secrets = (LINUX / 'ac_linux_import_secrets.cc').read_text()
        read = secrets[secrets.index('std::optional<Failure> ReadFirefoxLoginsDatabase('):]
        read = read[:read.index('\n}\n')]
        self.assertIn('Wipe(*pass);', read)
        self.assertIn('std::string* pass = fields ? fields->FindString("p") : nullptr;', read)


class FaviconTests(FirefoxStoreFixture):
    def test_chromium_favicons_for_tabs_and_toolbar_bookmarks(self):
        profile = self.chrome_profile('Default')
        (profile / 'Bookmarks').write_text(json.dumps({'roots': {
            'bookmark_bar': {'type': 'folder', 'name': 'Bar', 'children': [
                {'type': 'url', 'name': 'Bar site', 'url': 'https://bar.example/page'},
                {'type': 'url', 'name': 'Origin only', 'url': 'https://origin.example/deep/link#x'},
                {'type': 'url', 'name': 'No icon', 'url': 'https://none.example/'},
                {'type': 'url', 'name': 'Not png', 'url': 'https://gif.example/'}]},
            'other': {'type': 'folder', 'name': 'Other', 'children': [{'type': 'url', 'name': 'Other', 'url': 'https://other.example/'}]},
        }, 'version': 1}))
        db = sqlite3.connect(profile / 'Favicons')
        db.execute('CREATE TABLE favicons (id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL, icon_type INTEGER DEFAULT 1)')
        db.execute('CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER NOT NULL, last_updated INTEGER DEFAULT 0, '
                   'image_data BLOB, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, last_requested INTEGER DEFAULT 0)')
        db.execute('CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL, icon_id INTEGER, page_url_type INTEGER DEFAULT 0)')
        icons = [(1, 'https://bar.example/favicon.ico', 1), (2, 'https://origin.example/icon.png', 1), (3, 'https://other.example/i.png', 1),
                 (4, 'https://gif.example/i.gif', 1), (5, 'https://bar.example/touch.png', 2)]
        db.executemany('INSERT INTO favicons VALUES (?,?,?)', icons)
        db.executemany('INSERT INTO favicon_bitmaps (id, icon_id, image_data, width) VALUES (?,?,?,?)', [
            (1, 1, PNG + b'16', 16), (2, 1, PNG + b'32', 32), (3, 2, PNG + b'origin', 32), (4, 3, PNG + b'other', 16),
            (5, 4, b'GIF89a-not-png', 16), (6, 5, PNG + b'touch', 64)])
        db.executemany('INSERT INTO icon_mapping (page_url, icon_id) VALUES (?,?)', [
            ('https://bar.example/page', 1), ('https://bar.example/page', 5), ('https://origin.example/', 2),
            ('https://other.example/', 3), ('https://gif.example/', 4)])
        db.commit()
        db.close()
        out = self.read(self.chrome_name(), 'Default', ['bookmarks'])
        found = {f['page']: (f['icon'], base64.b64decode(f['png'])) for f in out['result']['favicons']}
        self.assertEqual(found, {
            'https://bar.example/page': ('https://bar.example/favicon.ico', PNG + b'32'),
            'https://origin.example/deep/link#x': ('https://origin.example/icon.png', PNG + b'origin'),
        })
        self.assertEqual(list(self.temp.iterdir()), [])
        self.assertEqual(self.read(self.chrome_name(), 'Default', ['history'])['result']['favicons'], [])

    def chrome_name(self):
        return 'chrome'

    def test_firefox_favicons_for_toolbar_bookmarks(self):
        profile = self.firefox_profile('icons.default')
        places = sqlite3.connect(profile / 'places.sqlite')
        places.executescript('''
            CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0,
              hidden INTEGER DEFAULT 0, typed INTEGER DEFAULT 0, last_visit_date INTEGER, guid TEXT);
            CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER, position INTEGER,
              title LONGVARCHAR, dateAdded INTEGER, lastModified INTEGER, guid TEXT);
            CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, from_visit INTEGER, place_id INTEGER, visit_date INTEGER, visit_type INTEGER);
            INSERT INTO moz_places (id, url, title, guid) VALUES (1, 'https://fox.example/a', 'Fox', 'p1'), (2, 'https://plain.example/', 'Plain', 'p2');
            INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 0, 0, 'root________');
            INSERT INTO moz_bookmarks VALUES (2, 2, NULL, 1, 0, 'toolbar', 0, 0, 'toolbar_____');
            INSERT INTO moz_bookmarks VALUES (3, 1, 1, 2, 0, 'Fox', 1000000, 0, 'b1');
            INSERT INTO moz_bookmarks VALUES (4, 1, 2, 2, 1, 'Plain', 1000000, 0, 'b2');
        ''')
        places.commit()
        places.close()
        icons = sqlite3.connect(profile / 'favicons.sqlite')
        icons.executescript('''
            CREATE TABLE moz_icons (id INTEGER PRIMARY KEY, icon_url TEXT NOT NULL, fixed_icon_url_hash INTEGER NOT NULL, width INTEGER NOT NULL DEFAULT 0,
              root INTEGER NOT NULL DEFAULT 0, color INTEGER, expire_ms INTEGER NOT NULL DEFAULT 0, flags INTEGER NOT NULL DEFAULT 0, data BLOB);
            CREATE TABLE moz_pages_w_icons (id INTEGER PRIMARY KEY, page_url TEXT NOT NULL, page_url_hash INTEGER NOT NULL);
            CREATE TABLE moz_icons_to_pages (page_id INTEGER NOT NULL, icon_id INTEGER NOT NULL, expire_ms INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (page_id, icon_id)) WITHOUT ROWID;
        ''')
        icons.executemany('INSERT INTO moz_icons (id, icon_url, fixed_icon_url_hash, width, data) VALUES (?,?,?,?,?)', [
            (1, 'https://fox.example/favicon.ico', 1, 16, PNG + b'fox16'), (2, 'https://fox.example/icon-64.png', 2, 64, PNG + b'fox64'),
            (3, 'https://plain.example/icon.svg', 3, 65535, b'<svg/>')])
        icons.executemany('INSERT INTO moz_pages_w_icons VALUES (?,?,?)', [(1, 'https://fox.example/a', 1), (2, 'https://plain.example/', 2)])
        icons.executemany('INSERT INTO moz_icons_to_pages (page_id, icon_id) VALUES (?,?)', [(1, 1), (1, 2), (2, 3)])
        icons.commit()
        icons.close()
        out = self.read_firefox('icons.default', ['bookmarks'])
        self.assertEqual([(f['page'], f['icon'], base64.b64decode(f['png'])) for f in out['result']['favicons']],
                         [('https://fox.example/a', 'https://fox.example/icon-64.png', PNG + b'fox64')])


class PortalTests(ImportFixture):
    def test_portal_protected_values_are_counted_with_the_supported_way_out(self):
        default = self.chrome_profile('Default')
        make_logins(default / 'Login Data', [
            ('https://portal.example/', '', 'pat', b'v12' + b'\0' * 32, 'https://portal.example/', webkit(1600000000000), 0, 0, 0),
            ('https://basic.example/', '', 'bea', aes_cbc(bytes.fromhex('fd621fe5a2b402539dfa147ca9272778'), b'basic pass'),
             'https://basic.example/', webkit(1600000000000), 0, 0, 0),
        ])
        out = self.json('read', *self.env_args(), 'chrome', 'Default', 'passwords', 0, 0, 0)
        self.assertEqual([c['username'] for c in out['credentials']], ['bea'])
        message = [w['message'] for w in out['result']['warnings'] if w['kind'] == 'passwords'][0]
        self.assertTrue(message.startswith("1 password protected by the desktop portal wasn't imported."), message)
        self.assertIn("gives each app its own key, so Ardia can't read Google Chrome's", message)
        self.assertIn('as a CSV file and import that file', message)


class FirefoxStoreSourceRules(unittest.TestCase):
    def test_new_fixtures_and_sources_have_no_comments(self):
        self.assertNotRegex((FIXTURES / 'nss_app_keys.py').read_text(), r'(?m)^\s*#')
        self.assertNotRegex(pathlib.Path(__file__).read_text(), r'(?m)^\s*#')
        for name in ['ac_linux_import_crypto.cc', 'ac_linux_import_secrets.cc', 'ac_linux_import_readers.cc', 'ac_linux_import_keyring.cc']:
            self.assertIsNone(re.search(r'(^|\s)//(?!\s*nogncheck)|/\*', (LINUX / name).read_text()), name)

    def test_the_firefox_unlock_runs_off_the_ui_thread_and_keeps_secrets_per_window(self):
        service = (LINUX / 'ac_linux_import_service.cc').read_text()
        self.assertIn('kKeyring,\n          base::BindOnce(&ReadFirefoxSecrets', service)
        handler = service[service.index('void FirefoxUnlocked('):]
        handler = handler[:handler.index('\n  }\n')]
        self.assertLess(handler.index('generation != SecretGeneration(owner)'), handler.index('unlocked_.Set('))
        self.assertIn('browser + kCardKeySuffix', handler)
        start = service[service.index('void StartImport('):]
        self.assertIn('options.firefox_card_key = unlocked_.Copy(requester.owner, browser + kCardKeySuffix, NowMs());', start)
        for source in ['ac_linux_import_readers.cc', 'ac_linux_import_secrets.cc']:
            self.assertIsNone(re.search(r'\bLOG\(|\bVLOG\(|\bprintf\(|std::cerr', (LINUX / source).read_text()), source)


if __name__ == '__main__':
    unittest.main()
