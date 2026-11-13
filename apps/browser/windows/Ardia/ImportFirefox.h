#pragma once

#include <winrt/Windows.Data.Json.h>

#include <filesystem>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "ImportFiles.h"
#include "ImportNss.h"
#include "ImportSecrets.h"

namespace Ardia {

namespace ImportFirefox {

using ImportNss::Code;
using ImportNss::Fail;
using ImportNss::Problem;
using ImportSecrets::Wiped;

inline constexpr uint64_t kLargestLoginsJson = 64ull << 20;

inline bool Decode64(std::string_view text, bool url, Wiped &out) noexcept {
  try {
    std::string padded{text};
    if (url) {
      for (char &c : padded) c = c == '-' ? '+' : c == '_' ? '/' : c;
      padded.append((4 - padded.size() % 4) % 4, '=');
    }
    DWORD size = 0;
    if (padded.empty() || padded.size() > 0x7fffffff ||
        !CryptStringToBinaryA(padded.c_str(), static_cast<DWORD>(padded.size()), CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr))
      return false;
    out.Resize(size);
    bool ok = CryptStringToBinaryA(padded.c_str(), static_cast<DWORD>(padded.size()), CRYPT_STRING_BASE64, out.Data(), &size, nullptr, nullptr) != 0;
    SecureZeroMemory(padded.data(), padded.size());
    if (!ok) out.Wipe();
    else ImportNss::Truncate(out, size);
    return ok;
  } catch (...) {
    return false;
  }
}

inline void AppendUtf8(Wiped &out, uint32_t cp) {
  uint8_t bytes[4];
  size_t n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  if (n == 1) bytes[0] = static_cast<uint8_t>(cp);
  else {
    for (size_t i = n - 1; i > 0; i--, cp >>= 6) bytes[i] = static_cast<uint8_t>(0x80 | (cp & 0x3f));
    bytes[0] = static_cast<uint8_t>((n == 2 ? 0xc0 : n == 3 ? 0xe0 : 0xf0) | cp);
  }
  out.Append(bytes, n);
}

inline int HexDigit(char c) noexcept {
  return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}

inline bool ReadHex4(std::string_view s, size_t at, uint32_t &value) noexcept {
  if (at + 4 > s.size()) return false;
  value = 0;
  for (size_t i = at; i < at + 4; i++) {
    char c = s[i];
    int digit = HexDigit(c);
    if (digit < 0) return false;
    value = (value << 4) | static_cast<uint32_t>(digit);
  }
  return true;
}

inline bool ReadJsonString(std::string_view s, size_t &at, Wiped *out) {
  if (at >= s.size() || s[at] != '"') return false;
  at++;
  while (at < s.size()) {
    char c = s[at++];
    if (c == '"') return true;
    if (static_cast<unsigned char>(c) < 0x20) return false;
    if (c != '\\') {
      if (out) out->Append(reinterpret_cast<const uint8_t *>(&c), 1);
      continue;
    }
    if (at >= s.size()) return false;
    char e = s[at++];
    uint32_t cp = 0;
    switch (e) {
      case '"': case '\\': case '/': cp = static_cast<uint8_t>(e); break;
      case 'b': cp = '\b'; break;
      case 'f': cp = '\f'; break;
      case 'n': cp = '\n'; break;
      case 'r': cp = '\r'; break;
      case 't': cp = '\t'; break;
      case 'u': {
        if (!ReadHex4(s, at, cp)) return false;
        at += 4;
        if (cp >= 0xd800 && cp <= 0xdbff) {
          uint32_t low = 0;
          if (at + 6 > s.size() || s[at] != '\\' || s[at + 1] != 'u' || !ReadHex4(s, at + 2, low) || low < 0xdc00 || low > 0xdfff) return false;
          at += 6;
          cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        } else if (cp >= 0xdc00 && cp <= 0xdfff) {
          return false;
        }
        break;
      }
      default: return false;
    }
    if (out) AppendUtf8(*out, cp);
  }
  return false;
}

inline void SkipSpace(std::string_view s, size_t &at) noexcept {
  while (at < s.size() && (s[at] == ' ' || s[at] == '\t' || s[at] == '\n' || s[at] == '\r')) at++;
}

inline bool SecureFields(std::string_view s, Wiped &user, Wiped &password, bool &hasPassword) {
  size_t at = 0;
  SkipSpace(s, at);
  if (at >= s.size() || s[at++] != '{') return false;
  SkipSpace(s, at);
  if (at < s.size() && s[at] == '}') return true;
  while (at < s.size()) {
    Wiped key;
    SkipSpace(s, at);
    if (!ReadJsonString(s, at, &key)) return false;
    SkipSpace(s, at);
    if (at >= s.size() || s[at++] != ':') return false;
    SkipSpace(s, at);
    Wiped *target = key.View() == "u" ? &user : key.View() == "p" ? &password : nullptr;
    if (at < s.size() && s[at] == '"') {
      if (target) target->Wipe();
      if (!ReadJsonString(s, at, target)) return false;
      if (target == &password) hasPassword = true;
    } else {
      while (at < s.size() && s[at] != ',' && s[at] != '}') {
        if (s[at] == '{' || s[at] == '[' || s[at] == '"') return false;
        at++;
      }
    }
    SkipSpace(s, at);
    if (at >= s.size()) return false;
    if (s[at] == '}') return true;
    if (s[at++] != ',') return false;
  }
  return false;
}

struct Login {
  std::string url;
  std::string username;
  std::string realm;
  std::optional<double> created;
  std::optional<double> lastUsed;
  std::optional<int64_t> timesUsed;
  std::string Identity() const { return realm + '\n' + url + '\n' + username; }
};

inline void AppendLogin(std::string &out, size_t &items, Login const &login, std::string_view password) {
  if (items++) out.push_back(',');
  out.append("{\"url\":");
  ImportFiles::AppendJsonString(out, login.url);
  out.append(",\"username\":");
  ImportFiles::AppendJsonString(out, login.username);
  out.append(",\"password\":");
  ImportFiles::AppendJsonString(out, password);
  out.append(",\"realm\":");
  ImportFiles::AppendJsonString(out, login.realm);
  if (login.created) {
    out.append(",\"created\":");
    ImportFiles::AppendNumber(out, *login.created);
  }
  if (login.lastUsed) {
    out.append(",\"lastUsed\":");
    ImportFiles::AppendNumber(out, *login.lastUsed);
  }
  if (login.timesUsed) out.append(",\"timesUsed\":").append(std::to_string(*login.timesUsed));
  out.push_back('}');
}

struct Collected {
  std::string items;
  size_t count = 0;
  size_t undecryptable = 0;
  std::set<std::string> identities;
  std::set<std::string> guids;
  ~Collected() noexcept { SecureZeroMemory(items.data(), items.size()); }
};

inline bool DecryptField(std::string_view base64, Wiped const &key, Wiped &out) {
  Wiped raw;
  if (!Decode64(base64, false, raw)) return false;
  auto der = ImportNss::ParseDer(raw.View());
  if (!der || der->children.size() < 3 || der->children[1].children.size() < 2) return false;
  std::string oid = der->children[1].children[0].Oid();
  std::string_view iv = der->children[1].children[1].content;
  std::string_view cipher = der->children[2].content;
  bool ok = false;
  if (oid == ImportNss::kOid3DesCbc && key.Size() >= 24) ok = ImportNss::CbcStrict(BCRYPT_3DES_ALGORITHM, key.View().substr(0, 24), iv, cipher, out);
  else if (oid == ImportNss::kOidAes256Cbc && key.Size() >= 32) ok = ImportNss::CbcStrict(BCRYPT_AES_ALGORITHM, key.View().substr(0, 32), iv, cipher, out);
  if (ok && !Files::IsValidUtf8(out.View())) {
    out.Wipe();
    ok = false;
  }
  return ok;
}

inline Problem FromJson(std::string_view text, Wiped const &key, Collected &into, bool skipKnown) {
  winrt::Windows::Data::Json::JsonObject top{nullptr};
  if (!Files::IsValidUtf8(text) || !winrt::Windows::Data::Json::JsonObject::TryParse(winrt::to_hstring(text), top)) return Fail(Code::unreadable, "logins.json is malformed");
  auto rows = top.GetNamedArray(L"logins", nullptr);
  if (!rows) return Fail(Code::unreadable, "logins.json is malformed");
  using winrt::Windows::Data::Json::JsonValueType;
  auto field = [](winrt::Windows::Data::Json::JsonObject const &row, const wchar_t *name) -> std::optional<std::string> {
    auto value = row.TryLookup(name);
    if (!value || value.ValueType() != JsonValueType::String) return std::nullopt;
    return winrt::to_string(value.GetString());
  };
  auto number = [](winrt::Windows::Data::Json::JsonObject const &row, const wchar_t *name) -> std::optional<double> {
    auto value = row.TryLookup(name);
    if (!value || value.ValueType() != JsonValueType::Number) return std::nullopt;
    return value.GetNumber();
  };
  for (auto const &entry : rows) {
    if (entry.ValueType() != JsonValueType::Object) return Fail(Code::unreadable, "logins.json is malformed");
    auto row = entry.GetObject();
    auto host = field(row, L"hostname");
    auto sealedUser = field(row, L"encryptedUsername");
    auto sealedPassword = field(row, L"encryptedPassword");
    if (!host || host->rfind("chrome://", 0) == 0 || !sealedUser || !sealedPassword) continue;
    Wiped user;
    Wiped password;
    if (!DecryptField(*sealedUser, key, user) || !DecryptField(*sealedPassword, key, password)) {
      into.undecryptable++;
      continue;
    }
    if (password.Size() == 0) continue;
    Login login;
    auto action = field(row, L"formSubmitURL");
    login.url = action && !action->empty() ? *action : *host;
    login.username = std::string{user.View()};
    login.realm = field(row, L"httpRealm").value_or(*host);
    login.created = number(row, L"timeCreated");
    login.lastUsed = number(row, L"timeLastUsed");
    if (auto used = number(row, L"timesUsed"); used && *used == std::floor(*used) && std::fabs(*used) < 9e15) login.timesUsed = static_cast<int64_t>(*used);
    auto guid = field(row, L"guid");
    if (skipKnown && ((guid && into.guids.count(*guid)) || into.identities.count(login.Identity()))) continue;
    AppendLogin(into.items, into.count, login, password.View());
  }
  return {};
}

inline bool OpenJwe(std::string_view compact, Wiped const &key, Wiped &out) {
  std::vector<std::string_view> parts;
  size_t start = 0;
  for (size_t dot; (dot = compact.find('.', start)) != std::string_view::npos; start = dot + 1) parts.push_back(compact.substr(start, dot - start));
  parts.push_back(compact.substr(start));
  if (parts.size() != 5 || !parts[1].empty()) return false;
  Wiped header;
  if (!Decode64(parts[0], true, header) || !Files::IsValidUtf8(header.View())) return false;
  winrt::Windows::Data::Json::JsonObject protectedHeader{nullptr};
  if (!winrt::Windows::Data::Json::JsonObject::TryParse(winrt::to_hstring(header.View()), protectedHeader) ||
      protectedHeader.GetNamedString(L"alg", L"") != L"dir" || protectedHeader.GetNamedString(L"enc", L"") != L"A256GCM")
    return false;
  Wiped iv;
  Wiped cipher;
  Wiped tag;
  if (!Decode64(parts[2], true, iv) || !Decode64(parts[4], true, tag) || (!parts[3].empty() && !Decode64(parts[3], true, cipher))) return false;
  return ImportNss::GcmOpen(key.View(), iv.View(), cipher.View(), tag.View(), parts[0], out);
}

inline Problem FromDatabase(sqlite3 *db, Wiped const &key, Collected &into) {
  if (!ImportFiles::TableExists(db, "loginsL")) return Fail(Code::unreadable, "logins.db has no logins");
  bool mirror = ImportFiles::TableExists(db, "loginsM");
  for (const char *table : {"loginsL", "loginsM"}) {
    if (std::string_view{table} == "loginsM" && !mirror) continue;
    ImportFiles::Statement guids{db, std::string{"SELECT guid FROM "} + table};
    if (!guids) return Fail(Code::unreadable, "logins.db has no logins");
    while (sqlite3_step(guids.Get()) == SQLITE_ROW) {
      std::string guid = ImportFiles::ColumnText(guids.Get(), 0);
      if (!guid.empty()) into.guids.insert(guid);
    }
  }
  std::string columns = "origin, httpRealm, formActionOrigin, timesUsed, timeCreated, timeLastUsed, secFields";
  std::string sql = "SELECT " + columns + " FROM loginsL WHERE is_deleted = 0";
  if (mirror) sql += " UNION ALL SELECT " + columns + " FROM loginsM WHERE is_overridden = 0 AND guid NOT IN (SELECT guid FROM loginsL)";
  ImportFiles::Statement select{db, sql};
  if (!select) return Fail(Code::unreadable, "logins.db has no logins");
  sqlite3_stmt *row = select.Get();
  int step = SQLITE_ROW;
  while ((step = sqlite3_step(row)) == SQLITE_ROW) {
    std::string origin = ImportFiles::ColumnText(row, 0);
    if (sqlite3_column_type(row, 0) == SQLITE_NULL || origin.rfind("chrome://", 0) == 0) continue;
    Wiped fields;
    Wiped user;
    Wiped password;
    bool hasPassword = false;
    if (!OpenJwe(ImportFiles::ColumnText(row, 6), key, fields) || !SecureFields(fields.View(), user, password, hasPassword)) {
      into.undecryptable++;
      continue;
    }
    if (!hasPassword || password.Size() == 0 || !Files::IsValidUtf8(password.View()) || !Files::IsValidUtf8(user.View())) continue;
    Login login;
    std::string action = ImportFiles::ColumnText(row, 2);
    login.url = action.empty() ? origin : action;
    login.username = std::string{user.View()};
    login.realm = sqlite3_column_type(row, 1) == SQLITE_NULL ? origin : ImportFiles::ColumnText(row, 1);
    if (auto created = ImportFiles::ColumnInt(row, 4)) login.created = static_cast<double>(*created);
    if (auto used = ImportFiles::ColumnInt(row, 5)) login.lastUsed = static_cast<double>(*used);
    login.timesUsed = ImportFiles::ColumnInt(row, 3).value_or(0);
    into.identities.insert(login.Identity());
    AppendLogin(into.items, into.count, login, password.View());
  }
  return step == SQLITE_DONE ? Problem{} : Fail(Code::unreadable, "logins.db has no logins");
}

inline bool Exists(std::filesystem::path const &path) noexcept {
  std::error_code ignored;
  return std::filesystem::is_regular_file(path, ignored);
}

inline std::optional<std::string> ReadSecretFile(std::filesystem::path const &path) noexcept {
  HANDLE file = Files::OpenForReading(path);
  if (file == INVALID_HANDLE_VALUE) return std::nullopt;
  auto bytes = ImportFiles::ReadOpened(file, kLargestLoginsJson);
  CloseHandle(file);
  return bytes;
}

inline std::string Answer(Collected const &collected, Problem problem, std::string const &failure) {
  std::string out = "{\"items\":[";
  if (!problem) out.append(collected.items);
  out.append("],\"undecryptable\":").append(std::to_string(collected.undecryptable)).append(",\"appBound\":0");
  if (problem) {
    out.append(",\"error\":{\"code\":\"").append(ImportNss::CodeName(problem.code)).append("\",\"message\":");
    ImportFiles::AppendJsonString(out, problem.message);
    out.push_back('}');
  }
  if (!failure.empty()) out.append(",\"failure\":").append(ImportFiles::JsonString(failure));
  out.push_back('}');
  return out;
}

inline std::string Logins(std::filesystem::path const &profile) {
  auto json = profile / L"logins.json";
  auto database = profile / L"logins.db";
  auto key4 = profile / L"key4.db";
  bool hasJson = Exists(json);
  bool hasDatabase = Exists(database);
  Collected collected;
  if (!hasJson && !hasDatabase) return Answer(collected, Fail(Code::notFound, "No saved logins in this profile"), {});
  if (!Exists(key4)) return Answer(collected, Fail(Code::unsupported, "This profile has no key4.db"), {});
  ImportFiles::Snapshot keys{key4};
  if (!keys.Db()) return Answer(collected, {}, keys.Failure());
  std::optional<Problem> databaseProblem;
  std::string databaseFailure;
  bool stored = false;
  if (hasDatabase) {
    Wiped key;
    Problem problem = ImportNss::MasterKey(keys.Db(), "", ImportNss::kLoginsDatabaseLabel, key);
    if (problem.code == Code::locked) return Answer(collected, problem, {});
    if (!problem) {
      ImportFiles::Snapshot snapshot{database};
      if (!snapshot.Db()) databaseFailure = snapshot.Failure();
      else problem = FromDatabase(snapshot.Db(), key, collected);
    }
    if (problem) databaseProblem = problem;
    stored = !problem && databaseFailure.empty();
    if (!stored) {
      SecureZeroMemory(collected.items.data(), collected.items.size());
      collected.items.clear();
      collected.count = 0;
      collected.identities.clear();
      collected.guids.clear();
    }
  }
  if (!hasJson) {
    if (stored) return Answer(collected, {}, {});
    return Answer(collected, databaseProblem.value_or(Problem{}), databaseFailure);
  }
  Wiped key;
  Problem problem = ImportNss::MasterKey(keys.Db(), "", std::nullopt, key);
  auto text = problem ? std::nullopt : ReadSecretFile(json);
  if (!problem && !text) problem = Fail(Code::unreadable, "logins.json is malformed");
  if (!problem) {
    Collected extra;
    extra.identities = collected.identities;
    extra.guids = collected.guids;
    problem = FromJson(*text, key, extra, stored);
    SecureZeroMemory(text->data(), text->size());
    if (!problem) {
      if (collected.count && extra.count) collected.items.push_back(',');
      collected.items.append(extra.items);
      collected.count += extra.count;
      collected.undecryptable += extra.undecryptable;
    }
  }
  if (problem && stored) return Answer(collected, {}, {});
  return Answer(collected, problem, {});
}

}

}
