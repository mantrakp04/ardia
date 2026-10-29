import ctypes
import json
import os
import subprocess
import sys
import tempfile

CKM_AES_GCM = 0x1087
CKA_ENCRYPT = 0x104
CKA_DECRYPT = 0x105
PK11_ORIGIN_GENERATED = 2


class SECItem(ctypes.Structure):
    _fields_ = [('type', ctypes.c_uint), ('data', ctypes.c_void_p), ('len', ctypes.c_uint)]


def create_profile(profile, password):
    with tempfile.NamedTemporaryFile('w', suffix='.pw') as pw:
        pw.write(password + '\n')
        pw.flush()
        args = ['certutil', '-N', '-d', f'sql:{profile}']
        args += ['-f', pw.name] if password else ['--empty-password']
        subprocess.run(args, check=True, capture_output=True, timeout=60)


def persist_keys(profile, password, keys):
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
    nss.PK11_Authenticate.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
    assert nss.PK11_Authenticate(slot, 1, None) == 0
    nss.PK11_ImportSymKeyWithFlags.restype = ctypes.c_void_p
    nss.PK11_ImportSymKeyWithFlags.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_uint, ctypes.c_ulong,
                                               ctypes.POINTER(SECItem), ctypes.c_ulong, ctypes.c_int, ctypes.c_void_p]
    nss.PK11_SetSymKeyNickname.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    nss.PK11_FreeSymKey.argtypes = [ctypes.c_void_p]
    for label, hex_key in keys.items():
        raw = bytes.fromhex(hex_key)
        buffer = ctypes.create_string_buffer(raw, len(raw))
        item = SECItem(0, ctypes.cast(buffer, ctypes.c_void_p), len(raw))
        key = nss.PK11_ImportSymKeyWithFlags(slot, CKM_AES_GCM, PK11_ORIGIN_GENERATED, CKA_ENCRYPT | CKA_DECRYPT,
                                             ctypes.byref(item), 0, 1, None)
        assert key
        assert nss.PK11_SetSymKeyNickname(key, label.encode()) == 0
        nss.PK11_FreeSymKey(key)
    nss.PK11_FreeSlot.argtypes = [ctypes.c_void_p]
    nss.PK11_FreeSlot(slot)
    assert nss.NSS_Shutdown() == 0


def main():
    profile, password, keys = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    if not os.path.exists(os.path.join(profile, 'key4.db')):
        create_profile(profile, password)
    persist_keys(profile, password, keys)


if __name__ == '__main__':
    main()
