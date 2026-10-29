#include "ardia/linux/ac_linux_import_secrets.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <utility>

#include "base/json/json_reader.h"

namespace ardia::linux_import {

namespace {

constexpr int64_t kWebKitOffsetMicros = 11644473600000000LL;
constexpr int kCancelRows = 128;
constexpr size_t kMaxLoginsJsonBytes = 64u * 1024 * 1024;

double WebKitMs(int64_t micros) {
  return micros > kWebKitOffsetMicros ? static_cast<double>(micros - kWebKitOffsetMicros) / 1000 : 0;
}

double UnixMicrosMs(int64_t micros) {
  return micros > 0 ? static_cast<double>(micros) / 1000 : 0;
}

std::string Trimmed(std::string_view text) {
  size_t begin = 0;
  size_t end = text.size();
  while (begin < end && (text[begin] == ' ' || text[begin] == '\t' || text[begin] == '\n' || text[begin] == '\r')) ++begin;
  while (end > begin && (text[end - 1] == ' ' || text[end - 1] == '\t' || text[end - 1] == '\n' || text[end - 1] == '\r')) --end;
  return std::string(text.substr(begin, end - begin));
}

std::string JoinParts(const std::vector<std::string>& parts, std::string_view separator) {
  std::string out;
  for (const std::string& part : parts) {
    const std::string kept = Trimmed(part);
    if (kept.empty()) continue;
    if (!out.empty()) out.append(separator);
    out += kept;
  }
  return out;
}

std::string Upper(std::string text) {
  for (char& c : text) {
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 32);
  }
  return text;
}

std::string ChromiumSameSite(int64_t value) {
  switch (value) {
    case 0:
      return "none";
    case 1:
      return "lax";
    case 2:
      return "strict";
    default:
      return "unspecified";
  }
}

std::string ChromiumPriority(int64_t value) {
  return value == 0 ? "low" : value == 2 ? "high" : "medium";
}

std::string ChromiumSourceScheme(int64_t value) {
  return value == 1 ? "nonSecure" : value == 2 ? "secure" : "unset";
}

std::optional<bool> Flag(const Statement& row, std::initializer_list<int> columns) {
  for (const int column : columns) {
    if (column >= 0) return row.Int(column) != 0;
  }
  return std::nullopt;
}

Failure SnapshotFailure(FileRead status, std::string_view what) {
  return Failure{status == FileRead::kTooLarge ? "tooLarge" : "unreadable", "Couldn't read " + std::string(what)};
}

std::string FirefoxSameSite(int64_t value, std::optional<int64_t> raw, bool secure) {
  if (raw && *raw != value) return "unspecified";
  switch (value) {
    case 0:
      return secure ? "none" : "unspecified";
    case 1:
      return "lax";
    case 2:
      return "strict";
    default:
      return "unspecified";
  }
}

bool PercentDecode(std::string_view text, std::string* out) {
  out->clear();
  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] != '%') {
      out->push_back(text[i]);
      continue;
    }
    if (i + 2 >= text.size()) return false;
    const auto hex = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    };
    const int high = hex(text[i + 1]);
    const int low = hex(text[i + 2]);
    if (high < 0 || low < 0) return false;
    out->push_back(static_cast<char>(high * 16 + low));
    i += 2;
  }
  return true;
}

struct OriginAttributes {
  bool isolated = false;
  bool partitioned = false;
  bool cross_site = false;
  std::string site;
};

OriginAttributes ParseOriginAttributes(std::string_view suffix) {
  OriginAttributes attributes;
  if (!suffix.empty() && suffix.front() == '^') suffix.remove_prefix(1);
  while (!suffix.empty()) {
    const size_t amp = suffix.find('&');
    const std::string_view pair = suffix.substr(0, amp);
    suffix = amp == std::string_view::npos ? std::string_view() : suffix.substr(amp + 1);
    if (pair.empty()) continue;
    const size_t equals = pair.find('=');
    const std::string_view key = pair.substr(0, equals);
    std::string value;
    if (key.empty() ||
        (equals != std::string_view::npos && !PercentDecode(pair.substr(equals + 1), &value))) {
      attributes.isolated = true;
      continue;
    }
    if (key == "userContextId" || key == "privateBrowsingId") {
      if (!value.empty() && value != "0") attributes.isolated = true;
    } else if (key == "firstPartyDomain" || key == "geckoViewSessionContextId") {
      if (!value.empty()) attributes.isolated = true;
    } else if (key == "partitionKey") {
      if (!FirefoxPartitionSite(value, &attributes.site, &attributes.cross_site)) {
        attributes.isolated = true;
      } else {
        attributes.partitioned = true;
      }
    }
  }
  return attributes;
}

void AppendNumber(std::string_view key, double value, std::string* out) {
  if (!std::isfinite(value) || value <= 0) return;
  out->append(",\"");
  out->append(key);
  out->append("\":");
  char buffer[40];
  if (value == std::floor(value) && value < 9e15) {
    std::snprintf(buffer, sizeof(buffer), "%lld", static_cast<long long>(value));
  } else {
    std::snprintf(buffer, sizeof(buffer), "%.3f", value);
  }
  out->append(buffer);
}

void AppendField(std::string_view key, std::string_view value, bool* first, std::string* out) {
  if (value.empty()) return;
  if (!*first) out->push_back(',');
  *first = false;
  AppendJsonString(key, out);
  out->push_back(':');
  AppendJsonString(value, out);
}

std::map<std::string, std::string> FirstValues(Database& db, const std::string& table,
                                               const std::function<std::string(const Statement&)>& build) {
  std::map<std::string, std::string> values;
  if (!db.HasTable(table)) return values;
  Statement rows(db.get(), "SELECT * FROM " + table + " ORDER BY rowid");
  const int guid = rows.Column("guid");
  while (rows.Step()) {
    const std::string id = rows.Text(guid);
    if (id.empty() || values.contains(id)) continue;
    std::string value = build(rows);
    if (!value.empty()) values.emplace(id, std::move(value));
  }
  return values;
}

}

ImportedVault::ImportedVault() = default;
ImportedVault::~ImportedVault() = default;

bool ImportedVault::Put(std::string_view owner, std::string_view token, ImportedData data, double now) {
  Expire(now);
  if (!ValidToken(token) || owner.empty()) return false;
  for (const Entry& entry : entries_) {
    if (entry.token == token) return false;
  }
  size_t owned = 0;
  for (const Entry& entry : entries_) owned += entry.owner == owner;
  if (owned >= kVaultEntriesPerOwner) {
    for (auto it = entries_.begin(); it != entries_.end(); ++it) {
      if (it->owner == owner) {
        entries_.erase(it);
        break;
      }
    }
  }
  entries_.push_back(Entry{std::string(owner), std::string(token), std::move(data), now});
  return true;
}

std::optional<ImportedData> ImportedVault::Take(std::string_view owner, std::string_view token, double now) {
  Expire(now);
  for (auto it = entries_.begin(); it != entries_.end(); ++it) {
    if (it->owner != owner || it->token != token) continue;
    ImportedData data = std::move(it->data);
    entries_.erase(it);
    return data;
  }
  return std::nullopt;
}

bool ImportedVault::Discard(std::string_view owner, std::string_view token) {
  for (auto it = entries_.begin(); it != entries_.end(); ++it) {
    if (it->owner == owner && it->token == token) {
      entries_.erase(it);
      return true;
    }
  }
  return false;
}

void ImportedVault::DiscardOwner(std::string_view owner) {
  std::erase_if(entries_, [owner](const Entry& entry) { return entry.owner == owner; });
}

void ImportedVault::Expire(double now) {
  std::erase_if(entries_, [now](const Entry& entry) { return now - entry.at >= kVaultLifetimeMs || now < entry.at; });
}

void ImportedVault::Clear() {
  entries_.clear();
}

UnlockedKeys::UnlockedKeys() = default;
UnlockedKeys::~UnlockedKeys() = default;

void UnlockedKeys::Set(std::string_view owner, std::string_view browser, SecretBytes secret, double now) {
  std::erase_if(entries_, [&](const Entry& entry) { return entry.owner == owner && entry.browser == browser; });
  entries_.push_back(Entry{std::string(owner), std::string(browser), std::move(secret), now});
}

std::optional<SecretBytes> UnlockedKeys::Copy(std::string_view owner, std::string_view browser, double now) const {
  for (const Entry& entry : entries_) {
    if (entry.owner == owner && entry.browser == browser && now - entry.at < kVaultLifetimeMs && now >= entry.at) {
      return entry.secret.Copy();
    }
  }
  return std::nullopt;
}

void UnlockedKeys::Forget(std::string_view owner) {
  std::erase_if(entries_, [owner](const Entry& entry) { return entry.owner == owner; });
}

void UnlockedKeys::Expire(double now) {
  std::erase_if(entries_, [now](const Entry& entry) { return now - entry.at >= kVaultLifetimeMs || now < entry.at; });
}

void UnlockedKeys::Clear() {
  entries_.clear();
}

namespace {

constexpr size_t kExactCookieBytes = 6;

struct LeakSet {
  std::set<std::string_view> values;
  std::set<std::string> cards;
  ~LeakSet() {
    while (!cards.empty()) {
      auto node = cards.extract(cards.begin());
      Wipe(node.value());
    }
  }
};

bool StringLeaks(std::string_view text, const LeakSet& leaks) {
  if (leaks.values.contains(text)) return true;
  if (leaks.cards.empty() || text.size() < 12 || text.size() > 64) return false;
  std::string digits;
  if (!CardDigits(text, &digits)) return false;
  const bool found = leaks.cards.contains(digits);
  Wipe(digits);
  return found;
}

bool ValueLeaks(const base::Value& value, const LeakSet& leaks, int depth) {
  if (depth > 64) return true;
  if (value.is_string()) return StringLeaks(value.GetString(), leaks);
  if (value.is_list()) {
    for (const base::Value& item : value.GetList()) {
      if (ValueLeaks(item, leaks, depth + 1)) return true;
    }
  }
  if (value.is_dict()) {
    for (const auto [key, item] : value.GetDict()) {
      if (StringLeaks(key, leaks) || ValueLeaks(item, leaks, depth + 1)) return true;
    }
  }
  return false;
}

}

bool ReplyLeaksImported(const base::Value& reply, const std::vector<ImportedCookie>& cookies,
                        const std::vector<ImportedCard>& cards) {
  LeakSet leaks;
  for (const ImportedCookie& cookie : cookies) {
    if (cookie.value.value().size() >= kExactCookieBytes) leaks.values.insert(cookie.value.value());
  }
  for (const ImportedCard& card : cards) {
    std::string digits;
    if (CardDigits(card.number.value(), &digits)) leaks.cards.insert(std::move(digits));
  }
  if (leaks.values.empty() && leaks.cards.empty()) return false;
  return ValueLeaks(reply, leaks, 0);
}

bool OutcomeLeaks(const ImportOutcome& outcome) {
  const base::Value reply(outcome.result.Clone());
  return ReplyLeaksImported(reply, outcome.cookies, outcome.cards) || ReplyLeaksSecret(reply, outcome.credentials);
}

bool ImportedAddress::Empty() const {
  return name.empty() && organization.empty() && street.empty() && city.empty() && state.empty() &&
         postal_code.empty() && country.empty() && phone.empty() && email.empty();
}

bool FirefoxPartitionSite(std::string_view key, std::string* site, bool* cross_site) {
  site->clear();
  *cross_site = false;
  if (key.size() < 2 || key.front() != '(' || key.back() != ')') return false;
  std::vector<std::string> fields;
  std::string_view inner = key.substr(1, key.size() - 2);
  while (true) {
    const size_t comma = inner.find(',');
    fields.emplace_back(inner.substr(0, comma));
    if (comma == std::string_view::npos) break;
    inner.remove_prefix(comma + 1);
  }
  bool ancestor = false;
  if (fields.size() >= 3 && fields.back() == "f") {
    ancestor = true;
    fields.pop_back();
  }
  if ((fields.size() != 2 && fields.size() != 3) || (fields[0] != "https" && fields[0] != "http")) return false;
  if (fields.size() == 3) {
    int64_t port = 0;
    if (!ParseInt64(fields[2], &port) || port < 1 || port > 65535) return false;
  }
  std::string host = fields[1];
  for (char& c : host) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + 32);
    const bool allowed = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
    if (!allowed) return false;
  }
  if (host.empty() || host.front() == '.' || host.back() == '.') return false;
  *site = fields[0] + "://" + host;
  *cross_site = ancestor;
  return true;
}

bool CardDigits(std::string_view number, std::string* digits) {
  digits->clear();
  for (const char c : number) {
    if (c >= '0' && c <= '9') {
      digits->push_back(c);
    } else if (c != ' ' && c != '-') {
      Wipe(*digits);
      digits->clear();
      return false;
    }
  }
  if (digits->size() < 12 || digits->size() > 19) {
    Wipe(*digits);
    digits->clear();
    return false;
  }
  return true;
}

void AppendJsonString(std::string_view text, std::string* out) {
  static constexpr char kHex[] = "0123456789abcdef";
  out->push_back('"');
  for (const char c : text) {
    const unsigned char byte = static_cast<unsigned char>(c);
    if (c == '"') {
      out->append("\\\"");
    } else if (c == '\\') {
      out->append("\\\\");
    } else if (byte < 0x20) {
      out->append("\\u00");
      out->push_back(kHex[byte >> 4]);
      out->push_back(kHex[byte & 0x0f]);
    } else {
      out->push_back(c);
    }
  }
  out->push_back('"');
}

SecretBytes CookiesPayload(const std::vector<ImportedCookie>& cookies, size_t begin, size_t end, int* dropped) {
  size_t bound = 64;
  for (size_t i = begin; i < end && i < cookies.size(); ++i) {
    const ImportedCookie& cookie = cookies[i];
    bound += 6 * (cookie.name.size() + cookie.value.value().size() + cookie.domain.size() + cookie.path.size() +
                  cookie.same_site.size() + cookie.priority.size() + cookie.partition_site.size() +
                  cookie.source_scheme.size()) +
             400;
  }
  std::string out;
  out.reserve(bound);
  out.append("{\"cookies\":[");
  bool first = true;
  for (size_t i = begin; i < end && i < cookies.size(); ++i) {
    const ImportedCookie& cookie = cookies[i];
    if (!ValidUtf8(cookie.value.value()) || !ValidUtf8(cookie.name) || !ValidUtf8(cookie.domain) ||
        !ValidUtf8(cookie.path)) {
      if (dropped) ++*dropped;
      continue;
    }
    if (!first) out.push_back(',');
    first = false;
    out.append("{\"name\":");
    AppendJsonString(cookie.name, &out);
    out.append(",\"value\":");
    AppendJsonString(cookie.value.value(), &out);
    out.append(",\"domain\":");
    AppendJsonString(cookie.domain, &out);
    out.append(",\"path\":");
    AppendJsonString(cookie.path, &out);
    AppendNumber("created", cookie.created, &out);
    AppendNumber("expires", cookie.expires, &out);
    AppendNumber("lastAccess", cookie.last_access, &out);
    out.append(cookie.secure ? ",\"secure\":true" : ",\"secure\":false");
    out.append(cookie.http_only ? ",\"httpOnly\":true" : ",\"httpOnly\":false");
    out.append(",\"sameSite\":");
    AppendJsonString(cookie.same_site, &out);
    out.append(",\"priority\":");
    AppendJsonString(cookie.priority, &out);
    if (cookie.partitioned) {
      out.append(",\"partitionKey\":{\"topLevelSite\":");
      AppendJsonString(cookie.partition_site, &out);
      out.append(cookie.partition_cross_site ? ",\"crossSite\":true}" : ",\"crossSite\":false}");
    }
    out.append(",\"sourceScheme\":");
    AppendJsonString(cookie.source_scheme, &out);
    out.append(",\"sourcePort\":");
    out.append(std::to_string(cookie.source_port >= 0 && cookie.source_port <= 65535 ? cookie.source_port : -1));
    out.push_back('}');
  }
  out.append("]}");
  return SecretBytes(std::move(out));
}

SecretBytes AutofillPayload(const std::vector<ImportedAddress>& addresses, const std::vector<ImportedCard>& cards,
                            size_t begin, size_t end) {
  size_t bound = 64;
  for (size_t i = begin; i < end && i < addresses.size(); ++i) {
    const ImportedAddress& a = addresses[i];
    bound += 6 * (a.name.size() + a.organization.size() + a.street.size() + a.city.size() + a.state.size() +
                  a.postal_code.size() + a.country.size() + a.phone.size() + a.email.size()) +
             200;
  }
  for (size_t i = begin; i < end && i < cards.size(); ++i) {
    bound += 6 * (cards[i].name.size() + cards[i].number.value().size() + cards[i].nickname.size()) + 200;
  }
  std::string out;
  out.reserve(bound);
  out.append("{\"addresses\":[");
  bool first_address = true;
  for (size_t i = begin; i < end && i < addresses.size(); ++i) {
    const ImportedAddress& a = addresses[i];
    if (a.Empty()) continue;
    if (!first_address) out.push_back(',');
    first_address = false;
    out.push_back('{');
    bool first = true;
    AppendField("name", a.name, &first, &out);
    AppendField("organization", a.organization, &first, &out);
    AppendField("street", a.street, &first, &out);
    AppendField("city", a.city, &first, &out);
    AppendField("state", a.state, &first, &out);
    AppendField("postalCode", a.postal_code, &first, &out);
    AppendField("country", a.country, &first, &out);
    AppendField("phone", a.phone, &first, &out);
    AppendField("email", a.email, &first, &out);
    out.push_back('}');
  }
  out.append("],\"cards\":[");
  bool first_card = true;
  for (size_t i = begin; i < end && i < cards.size(); ++i) {
    const ImportedCard& card = cards[i];
    std::string digits;
    if (!CardDigits(card.number.value(), &digits)) continue;
    if (!first_card) out.push_back(',');
    first_card = false;
    out.push_back('{');
    if (!card.name.empty()) {
      out.append("\"name\":");
      AppendJsonString(card.name, &out);
      out.push_back(',');
    }
    out.append("\"number\":\"");
    out.append(digits);
    Wipe(digits);
    out.push_back('"');
    if (card.exp_month > 0) out.append(",\"expMonth\":" + std::to_string(card.exp_month));
    if (card.exp_year > 0) out.append(",\"expYear\":" + std::to_string(card.exp_year));
    if (!card.nickname.empty()) {
      out.append(",\"nickname\":");
      AppendJsonString(card.nickname, &out);
    }
    out.push_back('}');
  }
  out.append("]}");
  return SecretBytes(std::move(out));
}

std::optional<Failure> ReadChromiumCookies(const std::string& directory, ScratchDirectory& scratch,
                                           ImportObserver& observer, const SecretBytes* key, double now_ms,
                                           CookieRead* out, bool* cancelled) {
  std::string file = Join(directory, "Network/Cookies");
  if (!IsFile(file)) file = Join(directory, "Cookies");
  if (!IsFile(file)) return Failure{"empty", "No cookies in this profile"};
  FileRead status = FileRead::kOk;
  std::unique_ptr<Database> db = Database::Snapshot(file, scratch, observer, &status);
  if (!db) return SnapshotFailure(status, "the cookies database");
  if (!db->HasTable("cookies")) return Failure{"unreadable", "Cookies has no cookies table"};
  int64_t version = 0;
  if (db->HasTable("meta")) {
    Statement meta(db->get(), "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'version'");
    if (meta.Step()) version = meta.Int(0);
  }
  const bool host_hashed = version >= 24;
  Statement rows(db->get(), "SELECT * FROM cookies");
  const int host = rows.Column("host_key");
  const int name = rows.Column("name");
  const int value = rows.Column("value");
  const int encrypted = rows.Column("encrypted_value");
  const int path = rows.Column("path");
  const int created = rows.Column("creation_utc");
  const int expires = rows.Column("expires_utc");
  const int accessed = rows.Column("last_access_utc");
  const int secure = rows.Column("is_secure");
  const int secure_old = rows.Column("secure");
  const int http_only = rows.Column("is_httponly");
  const int http_only_old = rows.Column("httponly");
  const int has_expires = rows.Column("has_expires");
  const int persistent = rows.Column("is_persistent");
  const int persistent_old = rows.Column("persistent");
  const int same_site = rows.Column("samesite");
  const int same_site_old = rows.Column("firstpartyonly");
  const int priority = rows.Column("priority");
  const int top_frame = rows.Column("top_frame_site_key");
  const int cross_site = rows.Column("has_cross_site_ancestor");
  const int source_scheme = rows.Column("source_scheme");
  const int source_port = rows.Column("source_port");
  if (host < 0 || name < 0) return Failure{"unreadable", "Cookies has an unexpected layout"};
  int seen = 0;
  while (rows.Step()) {
    if (++seen % kCancelRows == 0 && observer.Cancelled()) {
      *cancelled = true;
      return std::nullopt;
    }
    if (out->cookies.size() >= kMaxCookies) break;
    ImportedCookie cookie;
    cookie.domain = rows.Text(host);
    cookie.name = rows.Text(name);
    if (cookie.domain.empty()) continue;
    const bool lasting = Flag(rows, {has_expires, persistent, persistent_old}).value_or(true);
    cookie.expires = lasting ? WebKitMs(rows.Int(expires)) : 0;
    if (cookie.expires > 0 && cookie.expires < now_ms) continue;
    std::string plain = rows.Blob(value);
    std::string sealed = rows.Blob(encrypted);
    if (!plain.empty() && !sealed.empty()) {
      Wipe(plain);
      Wipe(sealed);
      ++out->undecryptable;
      continue;
    }
    if (!sealed.empty()) {
      std::string decrypted;
      const ValueDecrypt result =
          DecryptChromiumValue(sealed, key, host_hashed ? std::string_view(cookie.domain) : std::string_view(), &decrypted);
      Wipe(sealed);
      if (result == ValueDecrypt::kKeyring) {
        ++out->keyring;
        continue;
      }
      if (result == ValueDecrypt::kPortal) {
        ++out->portal;
        continue;
      }
      if (result != ValueDecrypt::kOk) {
        ++out->undecryptable;
        continue;
      }
      cookie.value = SecretBytes(std::move(decrypted));
    } else {
      cookie.value = SecretBytes(std::move(plain));
    }
    const std::string stored_path = rows.Text(path);
    cookie.path = stored_path.empty() ? "/" : stored_path;
    cookie.created = WebKitMs(rows.Int(created));
    cookie.last_access = WebKitMs(rows.Int(accessed));
    cookie.secure = Flag(rows, {secure, secure_old}).value_or(false);
    cookie.http_only = Flag(rows, {http_only, http_only_old}).value_or(false);
    cookie.same_site = ChromiumSameSite(same_site >= 0 ? rows.Int(same_site) : same_site_old >= 0 ? rows.Int(same_site_old) : -1);
    cookie.priority = ChromiumPriority(priority >= 0 ? rows.Int(priority) : 1);
    const std::string top = rows.Text(top_frame);
    if (!top.empty()) {
      cookie.partitioned = true;
      cookie.partition_site = top;
      cookie.partition_cross_site = cross_site >= 0 && rows.Int(cross_site) != 0;
    }
    cookie.source_scheme = ChromiumSourceScheme(source_scheme >= 0 ? rows.Int(source_scheme) : 0);
    const int64_t port = source_port >= 0 ? rows.Int(source_port) : -1;
    cookie.source_port = port >= 0 && port <= 65535 ? static_cast<int>(port) : -1;
    out->cookies.push_back(std::move(cookie));
  }
  if (!rows.ok() || rows.failed()) return Failure{"unreadable", "Couldn't read the cookies database"};
  return std::nullopt;
}

std::optional<Failure> ReadFirefoxCookies(const std::string& directory, ScratchDirectory& scratch,
                                          ImportObserver& observer, double now_ms, CookieRead* out, bool* cancelled) {
  const std::string file = Join(directory, "cookies.sqlite");
  if (!IsFile(file)) return Failure{"empty", "No cookies in this profile"};
  FileRead status = FileRead::kOk;
  std::unique_ptr<Database> db = Database::Snapshot(file, scratch, observer, &status);
  if (!db) return SnapshotFailure(status, "cookies.sqlite");
  if (!db->HasTable("moz_cookies")) return Failure{"unreadable", "cookies.sqlite has no cookies"};
  Statement rows(db->get(), "SELECT * FROM moz_cookies");
  const int host = rows.Column("host");
  const int name = rows.Column("name");
  const int value = rows.Column("value");
  const int path = rows.Column("path");
  const int expiry = rows.Column("expiry");
  const int accessed = rows.Column("lastAccessed");
  const int created = rows.Column("creationTime");
  const int secure = rows.Column("isSecure");
  const int http_only = rows.Column("isHttpOnly");
  const int same_site = rows.Column("sameSite");
  const int raw_same_site = rows.Column("rawSameSite");
  const int scheme_map = rows.Column("schemeMap");
  const int attributes = rows.Column("originAttributes");
  if (host < 0 || name < 0) return Failure{"unreadable", "cookies.sqlite has an unexpected layout"};
  int seen = 0;
  while (rows.Step()) {
    if (++seen % kCancelRows == 0 && observer.Cancelled()) {
      *cancelled = true;
      return std::nullopt;
    }
    if (out->cookies.size() >= kMaxCookies) break;
    const OriginAttributes origin = ParseOriginAttributes(rows.Text(attributes));
    if (origin.isolated) {
      ++out->skipped;
      continue;
    }
    ImportedCookie cookie;
    cookie.domain = rows.Text(host);
    cookie.name = rows.Text(name);
    if (cookie.domain.empty()) continue;
    double expires = static_cast<double>(rows.Int(expiry));
    if (expires > 0 && expires <= 100'000'000'000.0) expires *= 1000;
    cookie.expires = expires > 0 ? expires : 0;
    if (cookie.expires > 0 && cookie.expires < now_ms) continue;
    cookie.value = SecretBytes(rows.Text(value));
    const std::string stored_path = rows.Text(path);
    cookie.path = stored_path.empty() ? "/" : stored_path;
    cookie.created = UnixMicrosMs(rows.Int(created));
    cookie.last_access = UnixMicrosMs(rows.Int(accessed));
    cookie.secure = secure >= 0 && rows.Int(secure) != 0;
    cookie.http_only = http_only >= 0 && rows.Int(http_only) != 0;
    cookie.same_site = FirefoxSameSite(same_site >= 0 ? rows.Int(same_site) : -1,
                                       raw_same_site >= 0 && !rows.IsNull(raw_same_site)
                                           ? std::optional<int64_t>(rows.Int(raw_same_site))
                                           : std::nullopt,
                                       cookie.secure);
    const int64_t schemes = scheme_map >= 0 ? rows.Int(scheme_map) : 0;
    cookie.source_scheme = (schemes & 2) ? "secure" : (schemes & 1) ? "nonSecure" : "unset";
    if (origin.partitioned) {
      cookie.partitioned = true;
      cookie.partition_site = origin.site;
      cookie.partition_cross_site = origin.cross_site;
    }
    out->cookies.push_back(std::move(cookie));
  }
  if (!rows.ok() || rows.failed()) return Failure{"unreadable", "Couldn't read cookies.sqlite"};
  return std::nullopt;
}

std::optional<Failure> ReadChromiumAutofill(const std::string& directory, ScratchDirectory& scratch,
                                            ImportObserver& observer, const SecretBytes* key, AutofillRead* out,
                                            bool* cancelled) {
  const std::string file = Join(directory, "Web Data");
  if (!IsFile(file)) return Failure{"empty", "No autofill data in this profile"};
  FileRead status = FileRead::kOk;
  std::unique_ptr<Database> db = Database::Snapshot(file, scratch, observer, &status);
  if (!db) return SnapshotFailure(status, "Web Data");
  const bool any = db->HasTable("credit_cards") || db->HasTable("addresses") || db->HasTable("local_addresses") ||
                   db->HasTable("contact_info") || db->HasTable("autofill_profiles");
  if (!any) return Failure{"unreadable", "Web Data has no autofill tables"};

  std::vector<std::pair<std::string, ImportedAddress>> found;
  constexpr const char* kTokenTables[][2] = {{"addresses", "address_type_tokens"},
                                             {"local_addresses", "local_addresses_type_tokens"},
                                             {"contact_info", "contact_info_type_tokens"}};
  for (const auto& tables : kTokenTables) {
    if (!db->HasTable(tables[0]) || !db->HasTable(tables[1])) continue;
    if (observer.Cancelled()) {
      *cancelled = true;
      return std::nullopt;
    }
    std::vector<std::string> order;
    Statement guids(db->get(), std::string("SELECT guid FROM ") + tables[0] + " ORDER BY rowid");
    while (guids.Step()) order.push_back(guids.Text(0));
    std::map<std::string, std::map<int64_t, std::string>> values;
    Statement tokens(db->get(), std::string("SELECT guid, type, value FROM ") + tables[1]);
    while (tokens.Step()) {
      std::string value = Trimmed(tokens.Text(2));
      if (!value.empty()) values[tokens.Text(0)][tokens.Int(1)] = std::move(value);
    }
    for (const std::string& guid : order) {
      const auto fields = values.find(guid);
      if (fields == values.end()) continue;
      const auto field = [&](int64_t type) {
        const auto it = fields->second.find(type);
        return it == fields->second.end() ? std::string() : it->second;
      };
      ImportedAddress address;
      address.name = !field(7).empty() ? field(7) : JoinParts({field(3), field(5)}, " ");
      address.organization = field(60);
      address.street = !field(77).empty() ? field(77) : JoinParts({field(30), field(31)}, "\n");
      address.city = field(33);
      address.state = field(34);
      address.postal_code = field(35);
      address.country = Upper(field(36));
      address.phone = field(14);
      address.email = field(9);
      found.emplace_back(guid, std::move(address));
    }
  }
  if (db->HasTable("autofill_profiles")) {
    const auto names = FirstValues(*db, "autofill_profile_names", [](const Statement& row) {
      const std::string full = Trimmed(row.Text(row.Column("full_name")));
      return !full.empty() ? full
                           : JoinParts({row.Text(row.Column("first_name")), row.Text(row.Column("middle_name")),
                                        row.Text(row.Column("last_name"))},
                                       " ");
    });
    const auto emails = FirstValues(*db, "autofill_profile_emails",
                                    [](const Statement& row) { return Trimmed(row.Text(row.Column("email"))); });
    const auto phones = FirstValues(*db, "autofill_profile_phones",
                                    [](const Statement& row) { return Trimmed(row.Text(row.Column("number"))); });
    Statement rows(db->get(), "SELECT * FROM autofill_profiles ORDER BY rowid");
    const int guid = rows.Column("guid");
    while (rows.Step()) {
      const std::string id = rows.Text(guid);
      if (id.empty()) continue;
      const auto lookup = [&](const std::map<std::string, std::string>& map) {
        const auto it = map.find(id);
        return it == map.end() ? std::string() : it->second;
      };
      ImportedAddress address;
      address.name = lookup(names);
      address.organization = Trimmed(rows.Text(rows.Column("company_name")));
      const std::string street = Trimmed(rows.Text(rows.Column("street_address")));
      address.street = !street.empty()
                           ? street
                           : JoinParts({rows.Text(rows.Column("address_line_1")), rows.Text(rows.Column("address_line_2"))}, "\n");
      address.city = Trimmed(rows.Text(rows.Column("city")));
      address.state = Trimmed(rows.Text(rows.Column("state")));
      address.postal_code = Trimmed(rows.Text(rows.Column("zipcode")));
      address.country = Upper(Trimmed(rows.Text(rows.Column("country_code"))));
      address.phone = lookup(phones);
      address.email = lookup(emails);
      found.emplace_back(id, std::move(address));
    }
  }
  std::set<std::string> guids;
  for (auto& [guid, address] : found) {
    if (!guids.insert(guid).second || address.Empty()) continue;
    if (std::find(out->addresses.begin(), out->addresses.end(), address) != out->addresses.end()) continue;
    if (out->addresses.size() >= kMaxAutofillItems) break;
    out->addresses.push_back(std::move(address));
  }

  if (db->HasTable("credit_cards")) {
    Statement rows(db->get(), "SELECT * FROM credit_cards");
    const int number = rows.Column("card_number_encrypted");
    const int name = rows.Column("name_on_card");
    const int month = rows.Column("expiration_month");
    const int year = rows.Column("expiration_year");
    const int nickname = rows.Column("nickname");
    int seen = 0;
    while (rows.Step()) {
      if (++seen % kCancelRows == 0 && observer.Cancelled()) {
        *cancelled = true;
        return std::nullopt;
      }
      std::string sealed = rows.Blob(number);
      if (sealed.empty()) continue;
      std::string plain;
      const ValueDecrypt result = DecryptChromiumValue(sealed, key, std::string_view(), &plain);
      Wipe(sealed);
      if (result == ValueDecrypt::kKeyring) {
        ++out->locked_cards;
        continue;
      }
      if (result == ValueDecrypt::kPortal) {
        ++out->portal;
        continue;
      }
      std::string digits;
      if (result != ValueDecrypt::kOk || !CardDigits(plain, &digits)) {
        Wipe(plain);
        ++out->undecryptable;
        continue;
      }
      Wipe(digits);
      if (out->cards.size() >= kMaxAutofillItems) {
        Wipe(plain);
        break;
      }
      ImportedCard card;
      card.number = SecretBytes(std::move(plain));
      card.name = Trimmed(rows.Text(name));
      const int64_t m = month >= 0 ? rows.Int(month) : 0;
      card.exp_month = m >= 1 && m <= 12 ? static_cast<int>(m) : 0;
      const int64_t y = year >= 0 ? rows.Int(year) : 0;
      card.exp_year = y > 0 && y < 100 ? static_cast<int>(2000 + y) : y >= 1900 && y <= 2199 ? static_cast<int>(y) : 0;
      card.nickname = Trimmed(rows.Text(nickname));
      out->cards.push_back(std::move(card));
    }
    if (!rows.ok() || rows.failed()) return Failure{"unreadable", "Couldn't read the saved cards"};
  }
  return std::nullopt;
}

namespace {

std::optional<Failure> ReadFirefoxKeyDatabase(const std::string& directory, ScratchDirectory& scratch,
                                              const ImportObserver& observer, FirefoxKeyDatabase* out) {
  const std::string key4 = Join(directory, "key4.db");
  if (!IsFile(key4)) return Failure{"unsupported", "This profile has no key4.db"};
  FileRead status = FileRead::kOk;
  std::unique_ptr<Database> db = Database::Snapshot(key4, scratch, observer, &status);
  if (!db) return SnapshotFailure(status, "key4.db");
  if (!db->HasTable("metaData") || !db->HasTable("nssPrivate")) return Failure{"unsupported", "key4.db has an unexpected layout"};
  {
    Statement meta(db->get(), "SELECT item1, item2 FROM metaData WHERE id = 'password'");
    if (!meta.Step()) return Failure{"unreadable", "key4.db has no password entry"};
    out->global_salt = meta.Blob(0);
    out->check = meta.Blob(1);
  }
  Statement keys(db->get(), "SELECT * FROM nssPrivate");
  const int a11 = keys.Column("a11");
  const int a102 = keys.Column("a102");
  const int a3 = keys.Column("a3");
  while (keys.Step()) out->rows.push_back(FirefoxKeyRow{keys.Blob(a11), keys.Blob(a102), keys.Blob(a3)});
  return std::nullopt;
}

Failure FirefoxKeyFailure(FirefoxKey status, std::string_view what) {
  switch (status) {
    case FirefoxKey::kLocked:
      return Failure{"locked", "A Firefox primary password protects " + std::string(what)};
    case FirefoxKey::kUnsupported:
      return Failure{"unsupported", "key4.db uses an encryption Ardia can't read"};
    case FirefoxKey::kMissing:
      return Failure{"unreadable", "key4.db holds no key for " + std::string(what)};
    case FirefoxKey::kMalformed:
    case FirefoxKey::kOk:
      break;
  }
  return Failure{"unreadable", "key4.db is malformed"};
}

std::optional<Failure> ReadFirefoxLoginsJson(const std::string& directory, const FirefoxKeyDatabase& database,
                                             ImportObserver& observer, std::string_view primary_password,
                                             FirefoxLoginsRead* out, bool* cancelled) {
  const std::string logins = Join(directory, "logins.json");
  std::string text;
  const FileRead read = ReadFileLimited(logins, kMaxLoginsJsonBytes, &text);
  if (read != FileRead::kOk) return Failure{read == FileRead::kTooLarge ? "tooLarge" : "unreadable", "Couldn't read logins.json"};
  std::optional<base::DictValue> top = base::JSONReader::ReadDict(text, base::JSON_PARSE_RFC);
  Wipe(text);
  const base::ListValue* list = top ? top->FindList("logins") : nullptr;
  if (!list) return Failure{"unreadable", "logins.json is malformed"};
  if (list->empty()) return std::nullopt;
  FirefoxKeys key;
  const FirefoxKey opened = FirefoxMasterKeys(database.global_salt, database.check, database.rows, primary_password, &key);
  if (opened != FirefoxKey::kOk) return FirefoxKeyFailure(opened, "these passwords");
  size_t added = 0;
  int seen = 0;
  for (const base::Value& entry : *list) {
    if (++seen % kCancelRows == 0 && observer.Cancelled()) {
      *cancelled = true;
      out->credentials.clear();
      return std::nullopt;
    }
    if (!entry.is_dict()) continue;
    const base::DictValue& row = entry.GetDict();
    const std::string* host = row.FindString("hostname");
    const std::string* user = row.FindString("encryptedUsername");
    const std::string* pass = row.FindString("encryptedPassword");
    if (!host || host->rfind("chrome://", 0) == 0 || !user || !pass) continue;
    Credential credential;
    if (!DecryptFirefoxField(*user, key, &credential.username) ||
        !DecryptFirefoxField(*pass, key, &credential.password)) {
      ++out->undecryptable;
      continue;
    }
    if (credential.password.empty()) continue;
    const std::string* form = row.FindString("formSubmitURL");
    credential.url = form && !form->empty() ? *form : *host;
    const std::string* realm = row.FindString("httpRealm");
    credential.realm = realm && !realm->empty() ? *realm : *host;
    if (std::optional<double> value = row.FindDouble("timeCreated")) credential.created = *value;
    if (std::optional<double> value = row.FindDouble("timeLastUsed")) credential.last_used = *value;
    if (std::optional<int> value = row.FindInt("timesUsed")) credential.times_used = std::max(0, *value);
    if (added++ >= kMaxCredentials) break;
    out->credentials.push_back(std::move(credential));
  }
  return std::nullopt;
}

std::optional<Failure> ReadFirefoxLoginsDatabase(const std::string& directory, const FirefoxKeyDatabase& database,
                                                 ScratchDirectory& scratch, ImportObserver& observer,
                                                 std::string_view primary_password, FirefoxLoginsRead* out,
                                                 bool* cancelled) {
  SecretBytes key;
  const FirefoxKey opened = FirefoxNamedKey(database.global_salt, database.check, database.rows, primary_password,
                                            kFirefoxLoginsKeyLabel, &key);
  if (opened != FirefoxKey::kOk) return FirefoxKeyFailure(opened, "logins.db");
  FileRead status = FileRead::kOk;
  std::unique_ptr<Database> db = Database::Snapshot(Join(directory, "logins.db"), scratch, observer, &status);
  if (!db) return SnapshotFailure(status, "logins.db");
  const bool local = db->HasTable("loginsL");
  const bool mirror = db->HasTable("loginsM");
  if (!local && !mirror) return Failure{"unsupported", "logins.db has an unexpected layout"};
  const std::string columns = "origin, httpRealm, formActionOrigin, secFields, timeCreated, timeLastUsed, timesUsed";
  std::string sql;
  if (local) sql = "SELECT " + columns + " FROM loginsL WHERE is_deleted = 0";
  if (mirror) {
    if (!sql.empty()) sql += " UNION ALL ";
    sql += "SELECT " + columns + " FROM loginsM WHERE is_overridden = 0";
    if (local) sql += " AND guid NOT IN (SELECT guid FROM loginsL)";
  }
  Statement rows(db->get(), sql);
  if (!rows.ok()) return Failure{"unsupported", "logins.db has an unexpected layout"};
  size_t added = 0;
  int seen = 0;
  while (rows.Step()) {
    if (++seen % kCancelRows == 0 && observer.Cancelled()) {
      *cancelled = true;
      out->credentials.clear();
      return std::nullopt;
    }
    const std::string origin = rows.Text(0);
    if (origin.empty() || origin.rfind("chrome://", 0) == 0) continue;
    std::string sealed = rows.Text(3);
    std::string plain;
    const bool opened_fields = DecryptFirefoxJwe(sealed, key, &plain);
    Wipe(sealed);
    std::optional<base::DictValue> fields =
        opened_fields ? base::JSONReader::ReadDict(plain, base::JSON_PARSE_RFC) : std::nullopt;
    Wipe(plain);
    const std::string* user = fields ? fields->FindString("u") : nullptr;
    std::string* pass = fields ? fields->FindString("p") : nullptr;
    if (!user || !pass) {
      ++out->undecryptable;
      continue;
    }
    Credential credential;
    credential.username = *user;
    credential.password = *pass;
    Wipe(*pass);
    if (credential.password.empty()) continue;
    const std::string form = rows.Text(2);
    credential.url = !form.empty() ? form : origin;
    const std::string realm = rows.Text(1);
    credential.realm = !realm.empty() ? realm : origin;
    credential.created = static_cast<double>(std::max<int64_t>(0, rows.Int(4)));
    credential.last_used = static_cast<double>(std::max<int64_t>(0, rows.Int(5)));
    credential.times_used = static_cast<int>(std::clamp<int64_t>(rows.Int(6), 0, 1 << 30));
    if (added++ >= kMaxCredentials) break;
    out->credentials.push_back(std::move(credential));
  }
  if (rows.failed()) return Failure{"unreadable", "Couldn't read logins.db"};
  return std::nullopt;
}

std::string JsonText(const base::DictValue& record, std::string_view key) {
  const std::string* value = record.FindString(key);
  return value ? Trimmed(*value) : std::string();
}

int JsonInt(const base::DictValue& record, std::string_view key) {
  if (std::optional<int> value = record.FindInt(key)) return *value;
  if (std::optional<double> value = record.FindDouble(key)) {
    return std::isfinite(*value) && *value >= 0 && *value <= 9999 ? static_cast<int>(*value) : 0;
  }
  const std::string* text = record.FindString(key);
  if (!text || text->empty() || text->size() > 4) return 0;
  int out = 0;
  for (const char c : *text) {
    if (c < '0' || c > '9') return 0;
    out = out * 10 + (c - '0');
  }
  return out;
}

void SetExpiry(ImportedCard& card, int64_t month, int64_t year) {
  card.exp_month = month >= 1 && month <= 12 ? static_cast<int>(month) : 0;
  card.exp_year = year > 0 && year < 100 ? static_cast<int>(2000 + year) : year >= 1900 && year <= 2199 ? static_cast<int>(year) : 0;
}

bool KeepCard(AutofillRead* out, ImportedCard card) {
  std::string digits;
  if (!CardDigits(card.number.value(), &digits)) {
    ++out->undecryptable;
    return false;
  }
  for (const ImportedCard& existing : out->cards) {
    std::string other;
    const bool same = CardDigits(existing.number.value(), &other) && other == digits && existing.exp_month == card.exp_month &&
                      existing.exp_year == card.exp_year;
    Wipe(other);
    if (same) {
      Wipe(digits);
      return false;
    }
  }
  Wipe(digits);
  if (out->cards.size() >= kMaxAutofillItems) return false;
  out->cards.push_back(std::move(card));
  return true;
}

void KeepAddress(AutofillRead* out, ImportedAddress address) {
  if (address.Empty() || out->addresses.size() >= kMaxAutofillItems) return;
  if (std::find(out->addresses.begin(), out->addresses.end(), address) != out->addresses.end()) return;
  out->addresses.push_back(std::move(address));
}

std::optional<base::DictValue> ReadFirefoxAutofillJson(const std::string& directory) {
  std::string text;
  if (ReadFileLimited(Join(directory, "autofill-profiles.json"), kMaxLoginsJsonBytes, &text) != FileRead::kOk) return std::nullopt;
  std::optional<base::DictValue> top = base::JSONReader::ReadDict(text, base::JSON_PARSE_RFC);
  Wipe(text);
  return top;
}

bool LiveRecord(const base::Value& entry) {
  return entry.is_dict() && entry.GetDict().FindBool("deleted") != true;
}

int EncryptedJsonCards(const base::DictValue& top) {
  const base::ListValue* cards = top.FindList("creditCards");
  int count = 0;
  if (!cards) return 0;
  for (const base::Value& entry : *cards) {
    if (LiveRecord(entry) && !JsonText(entry.GetDict(), "cc-number-encrypted").empty()) ++count;
  }
  return count;
}

int DatabaseCards(const std::string& directory, ScratchDirectory& scratch, const ImportObserver& observer) {
  if (!IsFile(Join(directory, "autofill.db"))) return 0;
  FileRead status = FileRead::kOk;
  std::unique_ptr<Database> db = Database::Snapshot(Join(directory, "autofill.db"), scratch, observer, &status);
  if (!db || !db->HasTable("credit_cards_data")) return 0;
  Statement count(db->get(), "SELECT COUNT(*) FROM credit_cards_data WHERE cc_number_enc != ''");
  return count.Step() ? static_cast<int>(count.Int(0)) : 0;
}

}

FirefoxLock FirefoxProfileLock(const std::string& directory, ScratchDirectory& scratch, const ImportObserver& observer,
                               std::string_view primary_password) {
  FirefoxKeyDatabase keys;
  if (ReadFirefoxKeyDatabase(directory, scratch, observer, &keys)) return FirefoxLock::kNone;
  const FirefoxKey opened = FirefoxPasswordState(keys.global_salt, keys.check, primary_password);
  if (opened == FirefoxKey::kOk) return primary_password.empty() ? FirefoxLock::kNone : FirefoxLock::kOpened;
  if (opened != FirefoxKey::kLocked) return FirefoxLock::kNone;
  return FirefoxLock::kPrimaryPassword;
}

std::optional<Failure> ReadFirefoxLogins(const std::string& directory, ScratchDirectory& scratch,
                                         ImportObserver& observer, std::string_view primary_password,
                                         FirefoxLoginsRead* out, bool* cancelled) {
  const bool json = IsFile(Join(directory, "logins.json"));
  const bool database = IsFile(Join(directory, "logins.db"));
  if (!json && !database) return Failure{"empty", "No saved logins in this profile"};
  FirefoxKeyDatabase keys;
  if (std::optional<Failure> failure = ReadFirefoxKeyDatabase(directory, scratch, observer, &keys)) return failure;
  const FirefoxKey opened = FirefoxPasswordState(keys.global_salt, keys.check, primary_password);
  if (opened != FirefoxKey::kOk) return FirefoxKeyFailure(opened, "these passwords");
  std::optional<Failure> json_failure;
  std::optional<Failure> database_failure;
  if (json) json_failure = ReadFirefoxLoginsJson(directory, keys, observer, primary_password, out, cancelled);
  if (*cancelled) return std::nullopt;
  if (database) {
    database_failure = ReadFirefoxLoginsDatabase(directory, keys, scratch, observer, primary_password, out, cancelled);
  }
  if (*cancelled) return std::nullopt;
  if ((!json || json_failure) && (!database || database_failure)) return json_failure ? json_failure : database_failure;
  if (json_failure) out->notes.push_back("logins.json couldn't be read: " + json_failure->message);
  if (database_failure) out->notes.push_back("logins.db couldn't be read: " + database_failure->message);
  std::stable_sort(out->credentials.begin(), out->credentials.end(), [](const Credential& a, const Credential& b) {
    return std::max(a.last_used, a.created) > std::max(b.last_used, b.created);
  });
  RemoveDuplicateCredentials(out->credentials, false);
  while (out->credentials.size() > kMaxCredentials) out->credentials.pop_back();
  return std::nullopt;
}

bool FirefoxCardsNeedKeyring(const std::string& directory, ScratchDirectory& scratch, const ImportObserver& observer) {
  std::optional<base::DictValue> top = ReadFirefoxAutofillJson(directory);
  return top && EncryptedJsonCards(*top) > 0 && DatabaseCards(directory, scratch, observer) == 0;
}

std::optional<Failure> ReadFirefoxAutofill(const std::string& directory, ScratchDirectory& scratch,
                                           ImportObserver& observer, std::string_view primary_password,
                                           const SecretBytes* card_key, AutofillRead* out, bool* cancelled) {
  const bool database = IsFile(Join(directory, "autofill.db"));
  std::optional<base::DictValue> json = ReadFirefoxAutofillJson(directory);
  if (!database && !json) {
    if (IsFile(Join(directory, "autofill-profiles.json"))) return Failure{"unreadable", "autofill-profiles.json is malformed"};
    return Failure{"empty", "No saved addresses or cards in this profile"};
  }
  int database_cards = 0;
  if (database) {
    FileRead status = FileRead::kOk;
    std::unique_ptr<Database> db = Database::Snapshot(Join(directory, "autofill.db"), scratch, observer, &status);
    if (!db && !json) return SnapshotFailure(status, "autofill.db");
    if (!db) out->notes.push_back("autofill.db couldn't be read: " + SnapshotFailure(status, "autofill.db").message);
    if (db && db->HasTable("addresses_data")) {
      Statement rows(db->get(),
                     "SELECT name, organization, street_address, address_level2, address_level1, postal_code, country, "
                     "tel, email FROM addresses_data ORDER BY time_created");
      while (rows.Step()) {
        ImportedAddress address;
        address.name = Trimmed(rows.Text(0));
        address.organization = Trimmed(rows.Text(1));
        address.street = Trimmed(rows.Text(2));
        address.city = Trimmed(rows.Text(3));
        address.state = Trimmed(rows.Text(4));
        address.postal_code = Trimmed(rows.Text(5));
        address.country = Upper(Trimmed(rows.Text(6)));
        address.phone = Trimmed(rows.Text(7));
        address.email = Trimmed(rows.Text(8));
        KeepAddress(out, std::move(address));
      }
    }
    if (db && db->HasTable("credit_cards_data")) {
      Statement rows(db->get(),
                     "SELECT cc_name, cc_number_enc, cc_exp_month, cc_exp_year FROM credit_cards_data "
                     "WHERE cc_number_enc != '' ORDER BY time_created");
      std::optional<SecretBytes> key;
      std::optional<FirefoxKey> opened;
      int seen = 0;
      while (rows.Step()) {
        if (++seen % kCancelRows == 0 && observer.Cancelled()) {
          *cancelled = true;
          return std::nullopt;
        }
        ++database_cards;
        if (!opened) {
          FirefoxKeyDatabase keys;
          SecretBytes named;
          opened = ReadFirefoxKeyDatabase(directory, scratch, observer, &keys)
                       ? FirefoxKey::kMissing
                       : FirefoxNamedKey(keys.global_salt, keys.check, keys.rows, primary_password,
                                         kFirefoxAutofillKeyLabel, &named);
          if (*opened == FirefoxKey::kOk) key = std::move(named);
        }
        if (*opened == FirefoxKey::kLocked) {
          ++out->locked_cards;
          continue;
        }
        std::string sealed = rows.Text(1);
        std::string plain;
        const bool ok = key && DecryptFirefoxJwe(sealed, *key, &plain);
        Wipe(sealed);
        if (!ok) {
          ++out->undecryptable;
          continue;
        }
        ImportedCard card;
        card.name = Trimmed(rows.Text(0));
        card.number = SecretBytes(std::move(plain));
        SetExpiry(card, rows.Int(2), rows.Int(3));
        KeepCard(out, std::move(card));
      }
    }
  }
  if (json) {
    if (const base::ListValue* addresses = json->FindList("addresses")) {
      for (const base::Value& entry : *addresses) {
        if (!LiveRecord(entry)) continue;
        const base::DictValue& record = entry.GetDict();
        ImportedAddress address;
        address.name = JsonText(record, "name");
        if (address.name.empty()) {
          address.name = JoinParts({JsonText(record, "given-name"), JsonText(record, "additional-name"),
                                    JsonText(record, "family-name")},
                                   " ");
        }
        address.organization = JsonText(record, "organization");
        address.street = JsonText(record, "street-address");
        address.city = JsonText(record, "address-level2");
        address.state = JsonText(record, "address-level1");
        address.postal_code = JsonText(record, "postal-code");
        address.country = Upper(JsonText(record, "country"));
        address.phone = JsonText(record, "tel");
        address.email = JsonText(record, "email");
        KeepAddress(out, std::move(address));
      }
    }
    const base::ListValue* cards = json->FindList("creditCards");
    if (cards && database_cards == 0) {
      for (const base::Value& entry : *cards) {
        if (!LiveRecord(entry)) continue;
        const base::DictValue& record = entry.GetDict();
        const std::string* sealed = record.FindString("cc-number-encrypted");
        if (!sealed || sealed->empty()) continue;
        if (!card_key) {
          ++out->keyring_cards;
          continue;
        }
        std::string plain;
        if (!DecryptFirefoxOsKeyStore(*sealed, *card_key, &plain)) {
          ++out->undecryptable;
          continue;
        }
        ImportedCard card;
        card.name = JsonText(record, "cc-name");
        card.number = SecretBytes(std::move(plain));
        SetExpiry(card, JsonInt(record, "cc-exp-month"), JsonInt(record, "cc-exp-year"));
        KeepCard(out, std::move(card));
      }
    }
  }
  return std::nullopt;
}

}
