import hashlib
import json
import secrets
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'

VALUES = r'''
#pragma once
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>
namespace base {
class DictValue;
class ListValue;
using BlobStorage = std::vector<uint8_t>;
class Value {
 public:
  enum class Type { NONE, BOOLEAN, INT, DOUBLE, STRING, BINARY, DICT, LIST };
  Value() = default;
  explicit Value(bool value) : value_(value) {}
  explicit Value(int value) : value_(value) {}
  explicit Value(double value) : value_(value) {}
  explicit Value(std::string_view value) : value_(std::string(value)) {}
  explicit Value(const char* value) : value_(std::string(value)) {}
  explicit Value(std::string&& value) : value_(std::move(value)) {}
  explicit Value(BlobStorage&& value) : value_(std::move(value)) {}
  explicit Value(DictValue&&);
  explicit Value(ListValue&&);
  Value(Value&&) = default;
  Value& operator=(Value&&) = default;
  Value(const Value&) = delete;
  Value& operator=(const Value&) = delete;
  Type type() const { return static_cast<Type>(value_.index()); }
  bool is_none() const { return type() == Type::NONE; }
  bool is_bool() const { return type() == Type::BOOLEAN; }
  bool is_int() const { return type() == Type::INT; }
  bool is_double() const { return type() == Type::DOUBLE; }
  bool is_string() const { return type() == Type::STRING; }
  bool is_blob() const { return type() == Type::BINARY; }
  bool is_dict() const { return type() == Type::DICT; }
  bool is_list() const { return type() == Type::LIST; }
  double GetDouble() const { return is_int() ? std::get<int>(value_) : std::get<double>(value_); }
  int GetInt() const { return std::get<int>(value_); }
  bool GetBool() const { return std::get<bool>(value_); }
  const std::string& GetString() const { return std::get<std::string>(value_); }
  const BlobStorage& GetBlob() const { return std::get<BlobStorage>(value_); }
  DictValue& GetDict() { return *std::get<std::shared_ptr<DictValue>>(value_); }
  const DictValue& GetDict() const { return *std::get<std::shared_ptr<DictValue>>(value_); }
  ListValue& GetList() { return *std::get<std::shared_ptr<ListValue>>(value_); }
  const ListValue& GetList() const { return *std::get<std::shared_ptr<ListValue>>(value_); }
  DictValue TakeDict() &&;
  Value Clone() const;
  friend bool operator==(const Value&, const Value&);
 private:
  std::variant<std::monostate, bool, int, double, std::string, BlobStorage,
               std::shared_ptr<DictValue>, std::shared_ptr<ListValue>> value_;
};
class DictValue {
 public:
  DictValue() = default;
  DictValue(DictValue&&) = default;
  DictValue& operator=(DictValue&&) = default;
  DictValue(const DictValue&) = delete;
  DictValue& operator=(const DictValue&) = delete;
  class const_iterator {
   public:
    using Inner = std::map<std::string, Value, std::less<>>::const_iterator;
    explicit const_iterator(Inner inner) : inner_(inner) {}
    std::pair<const std::string&, const Value&> operator*() const { return {inner_->first, inner_->second}; }
    const_iterator& operator++() { ++inner_; return *this; }
    bool operator==(const const_iterator& other) const { return inner_ == other.inner_; }
    bool operator!=(const const_iterator& other) const { return inner_ != other.inner_; }
   private:
    Inner inner_;
  };
  const_iterator begin() const { return const_iterator(entries_.begin()); }
  const_iterator end() const { return const_iterator(entries_.end()); }
  size_t size() const { return entries_.size(); }
  bool contains(std::string_view key) const { return entries_.contains(key); }
  const Value* Find(std::string_view key) const {
    auto found = entries_.find(key);
    return found == entries_.end() ? nullptr : &found->second;
  }
  const DictValue* FindDict(std::string_view key) const {
    auto* value = Find(key); return value && value->is_dict() ? &value->GetDict() : nullptr;
  }
  const std::string* FindString(std::string_view key) const {
    auto* value = Find(key); return value && value->is_string() ? &value->GetString() : nullptr;
  }
  Value* Set(std::string_view key, Value&& value) & {
    auto [entry, inserted] = entries_.insert_or_assign(std::string(key), std::move(value));
    return &entry->second;
  }
  DictValue&& Set(std::string_view key, Value&& value) && { Set(key, std::move(value)); return std::move(*this); }
  Value* Set(std::string_view key, DictValue&& value) & { return Set(key, Value(std::move(value))); }
  DictValue&& Set(std::string_view key, DictValue&& value) && { Set(key, std::move(value)); return std::move(*this); }
  Value* Set(std::string_view key, std::string_view value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, std::string_view value) && { Set(key, value); return std::move(*this); }
  bool Remove(std::string_view key) { return entries_.erase(std::string(key)) != 0; }
  DictValue Clone() const {
    DictValue result;
    for (const auto& [key, value] : entries_) result.Set(key, value.Clone());
    return result;
  }
  friend bool operator==(const DictValue& a, const DictValue& b) { return a.entries_ == b.entries_; }
 private:
  std::map<std::string, Value, std::less<>> entries_;
};
class ListValue {
 public:
  ListValue() = default;
  ListValue(ListValue&&) = default;
  ListValue& operator=(ListValue&&) = default;
  ListValue(const ListValue&) = delete;
  ListValue& operator=(const ListValue&) = delete;
  auto begin() const { return entries_.begin(); }
  auto end() const { return entries_.end(); }
  size_t size() const { return entries_.size(); }
  const Value& operator[](size_t index) const { return entries_[index]; }
  void Append(Value&& value) & { entries_.push_back(std::move(value)); }
  ListValue&& Append(Value&& value) && { Append(std::move(value)); return std::move(*this); }
  ListValue Clone() const {
    ListValue result;
    for (const auto& value : entries_) result.Append(value.Clone());
    return result;
  }
  friend bool operator==(const ListValue& a, const ListValue& b) { return a.entries_ == b.entries_; }
 private:
  std::vector<Value> entries_;
};
inline Value::Value(DictValue&& value) : value_(std::make_shared<DictValue>(std::move(value))) {}
inline Value::Value(ListValue&& value) : value_(std::make_shared<ListValue>(std::move(value))) {}
inline DictValue Value::TakeDict() && { return std::move(GetDict()); }
inline Value Value::Clone() const {
  switch (type()) {
    case Type::NONE: return Value();
    case Type::BOOLEAN: return Value(GetBool());
    case Type::INT: return Value(GetInt());
    case Type::DOUBLE: return Value(GetDouble());
    case Type::STRING: return Value(std::string(GetString()));
    case Type::BINARY: return Value(BlobStorage(GetBlob()));
    case Type::DICT: return Value(GetDict().Clone());
    case Type::LIST: return Value(GetList().Clone());
  }
  __builtin_unreachable();
}
inline bool operator==(const Value& a, const Value& b) {
  if (a.type() != b.type()) return false;
  switch (a.type()) {
    case Value::Type::NONE: return true;
    case Value::Type::BOOLEAN: return a.GetBool() == b.GetBool();
    case Value::Type::INT: return a.GetInt() == b.GetInt();
    case Value::Type::DOUBLE: return a.GetDouble() == b.GetDouble();
    case Value::Type::STRING: return a.GetString() == b.GetString();
    case Value::Type::BINARY: return a.GetBlob() == b.GetBlob();
    case Value::Type::DICT: return a.GetDict() == b.GetDict();
    case Value::Type::LIST: return a.GetList() == b.GetList();
  }
  __builtin_unreachable();
}
class ValueView {
 public:
  ValueView(const Value& value) : value_(&value) {}
  ValueView(const DictValue& value) : value_(&value) {}
  ValueView(const ListValue& value) : value_(&value) {}
  Value Clone() const {
    return std::visit([](auto* value) -> Value {
      using T = std::remove_cv_t<std::remove_pointer_t<decltype(value)>>;
      if constexpr (std::is_same_v<T, Value>) return value->Clone();
      else return Value(value->Clone());
    }, value_);
  }
 private:
  std::variant<const Value*, const DictValue*, const ListValue*> value_;
};
}
'''

WRITER = r'''
#pragma once
#include <cmath>
#include <iomanip>
#include <optional>
#include <sstream>
#include "base/values.h"
namespace base {
enum JsonOptions { OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION = 2 };
inline std::string Escape(std::string_view text) {
  std::string result = "\"";
  const char hex[] = "0123456789abcdef";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') { result += '\\'; result += c; }
    else if (c < 32) { result += "\\u00"; result += hex[c >> 4]; result += hex[c & 15]; }
    else result += c;
  }
  return result + "\"";
}
inline std::string Encode(const Value& value) {
  if (value.is_none()) return "null";
  if (value.is_bool()) return value.GetBool() ? "true" : "false";
  if (value.is_int()) return std::to_string(value.GetInt());
  if (value.is_double()) { std::ostringstream out; out << std::setprecision(17) << value.GetDouble(); return out.str(); }
  if (value.is_string()) return Escape(value.GetString());
  std::string out = value.is_dict() ? "{" : "[";
  bool comma = false;
  if (value.is_dict()) {
    for (const auto& [key, item] : value.GetDict()) {
      if (comma) out += ',';
      comma = true;
      out += Escape(key) + ':' + Encode(item);
    }
  } else if (value.is_list()) {
    for (const auto& item : value.GetList()) {
      if (comma) out += ',';
      comma = true;
      out += Encode(item);
    }
  }
  return out + (value.is_dict() ? "}" : "]");
}
inline std::optional<std::string> WriteJsonWithOptions(ValueView value, uint32_t, size_t = 1000) {
  return Encode(value.Clone());
}
}
'''


def cpp_string(text):
    data = text.encode()
    escaped = ''.join(chr(byte) if 32 <= byte < 127 and byte not in (34, 92) else f'\\{byte:03o}' for byte in data)
    return f'std::string("{escaped}", {len(data)})'


def cpp_value(value):
    if value is None:
        return 'base::Value()'
    if isinstance(value, bool):
        return f'base::Value({str(value).lower()})'
    if isinstance(value, str):
        return f'base::Value({cpp_string(value)})'
    if isinstance(value, (int, float)):
        return f'base::Value({repr(value)})'
    if isinstance(value, list):
        items = ''.join(f'v.Append({cpp_value(item)});' for item in value)
        return f'[]{{base::ListValue v;{items}return base::Value(std::move(v));}}()'
    items = ''.join(f'v.Set({cpp_string(key)}, {cpp_value(item)});' for key, item in value.items())
    return f'[]{{base::DictValue v;{items}return base::Value(std::move(v));}}()'


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def compile_and_run(test, name, sources, args=(), extra_includes=()):
    compiler = shutil.which('clang++') or shutil.which('c++')
    if compiler is None:
        test.skipTest('C++ compiler is unavailable')
    with tempfile.TemporaryDirectory(prefix=f'ardia-{name}-') as directory:
        root = pathlib.Path(directory)
        executable = root / name
        compiled = subprocess.run([
            compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g',
            '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
            *[f'-I{path}' for path in extra_includes], '-I', str(ROOT / 'src'),
            *[str(source) for source in sources], '-o', str(executable),
        ], capture_output=True, text=True, timeout=120)
        test.assertEqual(compiled.returncode, 0, compiled.stderr)
        result = subprocess.run([str(executable), *args], capture_output=True, text=True, timeout=30)
        test.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout


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


NOW_MS = 1700000000000
CHROME_SECRET = secrets.token_urlsafe(24)


def keyring_key(secret=CHROME_SECRET):
    return hashlib.pbkdf2_hmac('sha1', secret.encode(), b'saltysalt', 1, 16)


def aes_cbc(key, data, prefix=b'v10'):
    args = ['openssl', 'enc', '-aes-128-cbc', '-K', key.hex(), '-iv', '20' * 16, '-nosalt']
    return prefix + subprocess.run(args, input=data, capture_output=True, timeout=30, check=True).stdout
