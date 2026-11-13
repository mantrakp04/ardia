#pragma once

#include <chrono>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ImportFiles.h"
#include "ImportFirefox.h"
#include "ImportNss.h"
#include "ImportSecrets.h"

namespace Ardia {

namespace ImportFirefox {

inline constexpr int64_t kSecondsOrMilliseconds = 100'000'000'000;

inline const char *FirefoxSameSite(std::optional<int64_t> value, std::optional<int64_t> raw, bool secure) noexcept {
  if (value && raw && *raw != *value) return "unspecified";
  if (value == 0) return secure ? "none" : "unspecified";
  if (value == 1) return "lax";
  if (value == 2) return "strict";
  return "unspecified";
}

inline std::string PercentDecoded(std::string_view text) {
  std::string out;
  for (size_t i = 0; i < text.size(); i++) {
    if (text[i] != '%') {
      out.push_back(text[i]);
      continue;
    }
    if (i + 2 >= text.size()) return std::string{text};
    int high = HexDigit(text[i + 1]);
    int low = HexDigit(text[i + 2]);
    if (high < 0 || low < 0) return std::string{text};
    out.push_back(static_cast<char>((high << 4) | low));
    i += 2;
  }
  return Files::IsValidUtf8(out) ? out : std::string{text};
}

inline std::optional<std::string> PartitionSite(std::string const &key) {
  if (key.size() < 2 || key.front() != '(' || key.back() != ')') return std::nullopt;
  std::vector<std::string> fields;
  std::string inner = key.substr(1, key.size() - 2);
  size_t start = 0;
  for (size_t comma; (comma = inner.find(',', start)) != std::string::npos; start = comma + 1) fields.push_back(inner.substr(start, comma - start));
  fields.push_back(inner.substr(start));
  if ((fields.size() != 2 && fields.size() != 3) || (fields[0] != "https" && fields[0] != "http")) return std::nullopt;
  if (fields.size() == 3) {
    if (fields[2].empty() || fields[2].size() > 5 || fields[2].find_first_not_of("0123456789") != std::string::npos) return std::nullopt;
    int port = std::stoi(fields[2]);
    if (port < 1 || port > 65535) return std::nullopt;
  }
  std::string host = fields[1];
  for (char &c : host) c = static_cast<char>(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
  if (host.empty() || host.front() == '.' || host.back() == '.' || host.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789.-_") != std::string::npos) return std::nullopt;
  return fields[0] + "://" + host;
}

struct Attributes {
  bool isolated = false;
  std::optional<std::string> partition;
};

inline Attributes OriginAttributes(std::string_view suffix) {
  Attributes out;
  if (!suffix.empty() && suffix.front() == '^') suffix.remove_prefix(1);
  size_t start = 0;
  while (start <= suffix.size()) {
    size_t amp = suffix.find('&', start);
    std::string_view pair = suffix.substr(start, amp == std::string_view::npos ? std::string_view::npos : amp - start);
    start = amp == std::string_view::npos ? suffix.size() + 1 : amp + 1;
    if (pair.empty()) continue;
    size_t eq = pair.find('=');
    std::string_view name = pair.substr(0, eq);
    if (name.empty()) {
      out.isolated = true;
      continue;
    }
    std::string value = eq == std::string_view::npos ? std::string{} : PercentDecoded(pair.substr(eq + 1));
    if (name == "userContextId" || name == "privateBrowsingId") {
      if (!value.empty() && value != "0") out.isolated = true;
    } else if (name == "firstPartyDomain" || name == "geckoViewSessionContextId") {
      if (!value.empty()) out.isolated = true;
    } else if (name == "partitionKey") {
      auto site = PartitionSite(value);
      if (!site) out.isolated = true;
      else out.partition = site;
    }
  }
  return out;
}

inline void AppendCookie(Wiped &batch, sqlite3_stmt *row, std::string const &host, std::string_view value, double expires, Attributes const &attributes) {
  auto column = [row](const char *name) { return ImportFiles::ColumnIndex(row, name); };
  std::string head = "{\"name\":";
  ImportFiles::AppendJsonString(head, ImportFiles::ColumnText(row, column("name")));
  head.append(",\"value\":");
  batch.Append(head);
  std::string quoted;
  quoted.reserve(value.size() * 6 + 2);
  ImportFiles::AppendJsonString(quoted, value);
  batch.Append(quoted);
  SecureZeroMemory(quoted.data(), quoted.size());
  std::string tail = ",\"domain\":";
  ImportFiles::AppendJsonString(tail, host);
  std::string path = ImportFiles::ColumnText(row, column("path"));
  tail.append(",\"path\":");
  ImportFiles::AppendJsonString(tail, path.empty() ? "/" : path);
  auto micros = [&](const char *name, const char *field) {
    auto at = ImportFiles::ColumnInt(row, column(name));
    if (!at || *at <= 0) return;
    tail.append(",\"").append(field).append("\":");
    ImportFiles::AppendNumber(tail, static_cast<double>(*at) / 1000.0);
  };
  micros("creationTime", "created");
  if (expires > 0) {
    tail.append(",\"expires\":");
    ImportFiles::AppendNumber(tail, expires);
  }
  micros("lastAccessed", "lastAccess");
  bool secure = ImportFiles::ColumnInt(row, column("isSecure")).value_or(0) != 0;
  tail.append(secure ? ",\"secure\":true" : ",\"secure\":false");
  tail.append(ImportFiles::ColumnInt(row, column("isHttpOnly")).value_or(0) != 0 ? ",\"httpOnly\":true" : ",\"httpOnly\":false");
  tail.append(",\"sameSite\":\"").append(FirefoxSameSite(ImportFiles::ColumnInt(row, column("sameSite")), ImportFiles::ColumnInt(row, column("rawSameSite")), secure));
  tail.append("\",\"priority\":\"medium\"");
  if (attributes.partition) {
    tail.append(",\"partitionKey\":{\"topLevelSite\":");
    ImportFiles::AppendJsonString(tail, *attributes.partition);
    tail.append(",\"crossSite\":false}");
  }
  int64_t scheme = ImportFiles::ColumnInt(row, column("schemeMap")).value_or(0);
  tail.append(",\"sourceScheme\":\"").append(scheme & 2 ? "secure" : scheme & 1 ? "nonSecure" : "unset").append("\",\"sourcePort\":-1}");
  batch.Append(tail);
}

inline std::string Cookies(std::filesystem::path const &file) {
  uint64_t started = ImportSecrets::Store::Shared().Generation();
  ImportFiles::Snapshot snapshot{file};
  if (!snapshot.Db()) return "{\"failure\":" + ImportFiles::JsonString(snapshot.Failure()) + "}";
  if (ImportFiles::TableIn(snapshot.Db(), "moz_cookies") != ImportFiles::Table::present) return "{\"failure\":\"unreadable\"}";
  ImportFiles::Statement select{snapshot.Db(), "SELECT * FROM moz_cookies"};
  if (!select) return "{\"failure\":\"unreadable\"}";
  sqlite3_stmt *row = select.Get();
  int hostColumn = ImportFiles::ColumnIndex(row, "host");
  int nameColumn = ImportFiles::ColumnIndex(row, "name");
  int valueColumn = ImportFiles::ColumnIndex(row, "value");
  int attributesColumn = ImportFiles::ColumnIndex(row, "originAttributes");
  int expiryColumn = ImportFiles::ColumnIndex(row, "expiry");
  double now = static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
  auto entry = std::make_shared<ImportSecrets::VaultEntry>();
  size_t count = 0;
  size_t skipped = 0;
  size_t inBatch = 0;
  int step = SQLITE_ROW;
  while ((step = sqlite3_step(row)) == SQLITE_ROW) {
    if (hostColumn < 0 || nameColumn < 0 || sqlite3_column_type(row, hostColumn) == SQLITE_NULL || sqlite3_column_type(row, nameColumn) == SQLITE_NULL) continue;
    std::string host = ImportFiles::ColumnText(row, hostColumn);
    Attributes attributes = OriginAttributes(ImportFiles::ColumnText(row, attributesColumn));
    if (attributes.isolated) {
      skipped++;
      continue;
    }
    int64_t expiry = ImportFiles::ColumnInt(row, expiryColumn).value_or(0);
    double expires = expiry > 0 ? (expiry > kSecondsOrMilliseconds ? static_cast<double>(expiry) : static_cast<double>(expiry) * 1000.0) : 0;
    if (expires > 0 && expires < now) continue;
    std::string_view value = ImportNss::Blob(row, valueColumn);
    if (!Files::IsValidUtf8(value)) {
      entry->dropped++;
      continue;
    }
    if (entry->batches.empty() || inBatch == ImportSecrets::kCookieBatch) {
      if (!entry->batches.empty()) ImportSecrets::CloseBatch(*entry->batches.back());
      entry->batches.push_back(std::make_unique<Wiped>());
      entry->batches.back()->Append("{\"cookies\":[");
      inBatch = 0;
    }
    if (inBatch++) entry->batches.back()->Append(",");
    AppendCookie(*entry->batches.back(), row, host, value, expires, attributes);
    count++;
  }
  if (step != SQLITE_DONE) return "{\"failure\":\"unreadable\"}";
  if (!entry->batches.empty()) ImportSecrets::CloseBatch(*entry->batches.back());
  std::string token = count ? ImportSecrets::Store::Shared().Keep(entry, started) : std::string{};
  if (count && token.empty()) return "{\"failure\":\"cancelled\"}";
  std::string out = "{\"count\":" + std::to_string(count) + ",\"undecryptable\":0,\"appBound\":0,\"dropped\":" + std::to_string(entry->dropped) +
                    ",\"skipped\":" + std::to_string(skipped);
  if (!token.empty()) out.append(",\"token\":").append(ImportFiles::JsonString(token));
  out.push_back('}');
  return out;
}

}

}
