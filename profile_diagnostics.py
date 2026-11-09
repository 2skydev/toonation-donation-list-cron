import hashlib
import json
import sqlite3
import sys
import time
import base64
from pathlib import Path

profile = Path('.cache/toonation-profile')
state_path = profile / 'Local State'
state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
key_hashes = {
    name: hashlib.sha256(value.encode()).hexdigest()
    for name in ('encrypted_key', 'app_bound_encrypted_key')
    if isinstance(value := state.get('os_crypt', {}).get(name), str)
}
dpapi = None
encoded_key = state.get('os_crypt', {}).get('encrypted_key')
if sys.platform == 'win32' and isinstance(encoded_key, str):
    import ctypes
    from ctypes import wintypes

    encrypted_key = base64.b64decode(encoded_key)
    if encrypted_key.startswith(b'DPAPI'):
        class DataBlob(ctypes.Structure):
            _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

        buffer = ctypes.create_string_buffer(encrypted_key[5:])
        source = DataBlob(len(encrypted_key) - 5, ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
        output = DataBlob()
        crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
        crypt32.CryptUnprotectData.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
        crypt32.CryptUnprotectData.restype = wintypes.BOOL
        success = crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 0, ctypes.byref(output))
        dpapi = {'canDecrypt': bool(success), 'errorCode': 0 if success else ctypes.get_last_error()}
        if success:
            ctypes.memset(output.data, 0, output.size)
            kernel32 = ctypes.WinDLL('kernel32')
            kernel32.LocalFree.argtypes = [ctypes.c_void_p]
            kernel32.LocalFree.restype = ctypes.c_void_p
            kernel32.LocalFree(output.data)
databases = []

for relative_path in ('Default/Network/Cookies', 'Default/Cookies'):
    path = profile / relative_path
    if not path.exists():
        continue

    database = {'path': relative_path, 'cookies': []}
    try:
        connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            rows = connection.execute('''
                SELECT host_key, name, path, expires_utc, is_persistent,
                       is_httponly, is_secure, samesite, length(value), encrypted_value
                FROM cookies
                WHERE host_key = 'toon.at' OR host_key = '.toon.at'
                   OR host_key LIKE '%.toon.at'
                ORDER BY host_key, name, path
            ''')
            for domain, name, cookie_path, expiry, persistent, http_only, secure, same_site, plain_length, encrypted in rows:
                expires = expiry / 1_000_000 - 11_644_473_600 if expiry else None
                database['cookies'].append({
                    'name': name,
                    'domain': domain,
                    'path': cookie_path,
                    'expires': expires,
                    'expired': bool(persistent and expires is not None and expires <= time.time()),
                    'persistent': bool(persistent),
                    'httpOnly': bool(http_only),
                    'secure': bool(secure),
                    'sameSite': same_site,
                    'hasPlaintextValue': bool(plain_length),
                    'encryptedValueLength': len(encrypted),
                    'encryptedValueHash': hashlib.sha256(encrypted).hexdigest() if encrypted else None,
                    'encryptionVersion': encrypted[:3].decode() if encrypted[:3] in (b'v10', b'v11', b'v20') else None,
                })
        finally:
            connection.close()
    except sqlite3.Error:
        database['unavailable'] = True
    databases.append(database)

print(json.dumps({'keyHashes': key_hashes, 'dpapi': dpapi, 'databases': databases}))
