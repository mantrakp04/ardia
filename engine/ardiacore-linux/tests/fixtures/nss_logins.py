import base64
import ctypes
import json
import subprocess
import sys
import tempfile


class SECItem(ctypes.Structure):
    _fields_ = [('type', ctypes.c_uint), ('data', ctypes.c_void_p), ('len', ctypes.c_uint)]


def create_profile(profile, password):
    with tempfile.NamedTemporaryFile('w', suffix='.pw') as pw:
        pw.write(password + '\n')
        pw.flush()
        args = ['certutil', '-N', '-d', f'sql:{profile}']
        args += ['-f', pw.name] if password else ['--empty-password']
        subprocess.run(args, check=True, capture_output=True, timeout=60)


def encrypt_all(profile, password, values):
    nss = ctypes.CDLL('libnss3.so')
    plc = ctypes.CDLL('libplc4.so')
    plc.PL_strdup.restype = ctypes.c_void_p
    plc.PL_strdup.argtypes = [ctypes.c_char_p]
    callback_type = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p)
    callback = callback_type(lambda slot, retry, arg: None if retry else plc.PL_strdup(password.encode()))
    nss.PK11_SetPasswordFunc(callback)
    assert nss.NSS_InitReadWrite(f'sql:{profile}'.encode()) == 0
    nss.PK11_GetInternalKeySlot.restype = ctypes.c_void_p
    slot = nss.PK11_GetInternalKeySlot()
    if password:
        nss.PK11_Authenticate.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
        assert nss.PK11_Authenticate(slot, 1, None) == 0
    out = []
    nss.PK11SDR_Encrypt.argtypes = [ctypes.POINTER(SECItem), ctypes.POINTER(SECItem), ctypes.POINTER(SECItem), ctypes.c_void_p]
    for value in values:
        raw = value.encode()
        buffer = ctypes.create_string_buffer(raw, len(raw))
        data = SECItem(0, ctypes.cast(buffer, ctypes.c_void_p), len(raw))
        key_id = SECItem(0, None, 0)
        result = SECItem(0, None, 0)
        assert nss.PK11SDR_Encrypt(ctypes.byref(key_id), ctypes.byref(data), ctypes.byref(result), None) == 0
        out.append(base64.b64encode(ctypes.string_at(result.data, result.len)).decode())
    nss.PK11_FreeSlot.argtypes = [ctypes.c_void_p]
    nss.PK11_FreeSlot(slot)
    assert nss.NSS_Shutdown() == 0
    return out


def main():
    profile, password, rows = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    create_profile(profile, password)
    values = [value for row in rows for value in (row['username'], row['password'])]
    encrypted = encrypt_all(profile, password, values)
    logins = []
    for index, row in enumerate(rows):
        logins.append({
            'id': index + 1, 'hostname': row['hostname'], 'httpRealm': row.get('httpRealm'),
            'formSubmitURL': row.get('formSubmitURL', ''), 'usernameField': '', 'passwordField': '',
            'encryptedUsername': encrypted[2 * index], 'encryptedPassword': encrypted[2 * index + 1],
            'guid': '{%d}' % index, 'encType': 1, 'timeCreated': 1600000000000, 'timeLastUsed': 1700000000000,
            'timePasswordChanged': 1600000000000, 'timesUsed': row.get('timesUsed', 1),
        })
    with open(f'{profile}/logins.json', 'w') as out:
        json.dump({'nextId': len(rows) + 1, 'logins': logins, 'version': 3}, out)


if __name__ == '__main__':
    main()
