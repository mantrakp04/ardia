#pragma once

#include <array>
#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "ImportFiles.h"
#include "ImportSecrets.h"

namespace Ardia {

namespace ImportAutofill {

using ImportSecrets::Wiped;
using Text = std::optional<std::string>;

inline constexpr size_t kAutofillBatch = 500;

enum Field { nameFirst = 3, nameLast = 5, nameFull = 7, email = 9, phone = 14, line1 = 30, line2 = 31, city = 33, state = 34, zip = 35, country = 36, company = 60, street = 77 };

struct Address {
  std::array<Text, 9> fields;
  bool Empty() const noexcept {
    for (auto const &f : fields)
      if (f) return false;
    return true;
  }
  bool operator==(Address const &other) const { return fields == other.fields; }
};

inline constexpr std::array<const char *, 9> kAddressKeys = {"name", "organization", "street", "city", "state", "postalCode", "country", "phone", "email"};

inline Text NonEmpty(std::string text) {
  size_t start = text.find_first_not_of(" \t\r\n\v\f");
  if (start == std::string::npos) return std::nullopt;
  size_t end = text.find_last_not_of(" \t\r\n\v\f");
  return text.substr(start, end - start + 1);
}

inline Text Joined(std::vector<Text> const &parts, std::string_view separator) {
  std::string out;
  bool any = false;
  for (auto const &part : parts) {
    if (!part) continue;
    if (any) out.append(separator);
    out.append(*part);
    any = true;
  }
  return any ? Text{out} : std::nullopt;
}

inline Text Upper(Text text) {
  if (text)
    for (char &c : *text) c = static_cast<char>(c >= 'a' && c <= 'z' ? c - 'a' + 'A' : c);
  return text;
}

struct Broken {
  bool any = false;
  void Finished(ImportFiles::Statement const &statement, int step) noexcept {
    if (!statement || step != SQLITE_DONE) any = true;
  }
};

inline int Step(ImportFiles::Statement const &statement) noexcept { return statement ? sqlite3_step(statement.Get()) : SQLITE_ERROR; }

inline Text TextAt(sqlite3_stmt *row, const char *column) { return NonEmpty(ImportFiles::ColumnText(row, ImportFiles::ColumnIndex(row, column))); }

inline std::vector<std::pair<std::string, Address>> TokenAddresses(sqlite3 *db, std::string const &table, std::string const &tokens, Broken &broken) {
  std::vector<std::string> order;
  ImportFiles::Statement guids{db, "SELECT guid FROM " + table + " ORDER BY rowid"};
  int step = SQLITE_ROW;
  while ((step = Step(guids)) == SQLITE_ROW)
    if (sqlite3_column_type(guids.Get(), 0) != SQLITE_NULL) order.push_back(ImportFiles::ColumnText(guids.Get(), 0));
  broken.Finished(guids, step);
  std::map<std::string, std::map<int64_t, std::string>> values;
  ImportFiles::Statement rows{db, "SELECT guid, type, value FROM " + tokens};
  while ((step = Step(rows)) == SQLITE_ROW) {
    if (sqlite3_column_type(rows.Get(), 0) == SQLITE_NULL) continue;
    Text value = NonEmpty(ImportFiles::ColumnText(rows.Get(), 2));
    if (value) values[ImportFiles::ColumnText(rows.Get(), 0)][ImportFiles::ColumnInt(rows.Get(), 1).value_or(0)] = *value;
  }
  broken.Finished(rows, step);
  std::vector<std::pair<std::string, Address>> out;
  for (auto const &guid : order) {
    auto found = values.find(guid);
    if (found == values.end()) continue;
    auto field = [&](int key) -> Text {
      auto at = found->second.find(key);
      return at == found->second.end() ? std::nullopt : Text{at->second};
    };
    Address a;
    a.fields = {field(nameFull) ? field(nameFull) : Joined({field(nameFirst), field(nameLast)}, " "),
                field(company),
                field(street) ? field(street) : Joined({field(line1), field(line2)}, "\n"),
                field(city),
                field(state),
                field(zip),
                Upper(field(country)),
                field(phone),
                field(email)};
    out.emplace_back(guid, std::move(a));
  }
  return out;
}

inline std::map<std::string, std::string> FirstValues(sqlite3 *db, const char *table, Text (*build)(sqlite3_stmt *), Broken &broken) {
  std::map<std::string, std::string> out;
  if (!ImportFiles::TableExists(db, table)) return out;
  ImportFiles::Statement rows{db, std::string{"SELECT * FROM "} + table + " ORDER BY rowid"};
  int step = SQLITE_ROW;
  while ((step = Step(rows)) == SQLITE_ROW) {
    int guid = ImportFiles::ColumnIndex(rows.Get(), "guid");
    if (guid < 0 || sqlite3_column_type(rows.Get(), guid) == SQLITE_NULL) continue;
    std::string key = ImportFiles::ColumnText(rows.Get(), guid);
    if (out.count(key)) continue;
    if (Text value = build(rows.Get())) out[key] = *value;
  }
  broken.Finished(rows, step);
  return out;
}

inline std::vector<std::pair<std::string, Address>> LegacyAddresses(sqlite3 *db, Broken &broken) {
  auto names = FirstValues(db, "autofill_profile_names", [](sqlite3_stmt *row) -> Text {
    Text full = TextAt(row, "full_name");
    return full ? full : Joined({TextAt(row, "first_name"), TextAt(row, "middle_name"), TextAt(row, "last_name")}, " ");
  }, broken);
  auto emails = FirstValues(db, "autofill_profile_emails", [](sqlite3_stmt *row) { return TextAt(row, "email"); }, broken);
  auto phones = FirstValues(db, "autofill_profile_phones", [](sqlite3_stmt *row) { return TextAt(row, "number"); }, broken);
  auto lookup = [](std::map<std::string, std::string> const &from, std::string const &guid) -> Text {
    auto found = from.find(guid);
    return found == from.end() ? std::nullopt : Text{found->second};
  };
  std::vector<std::pair<std::string, Address>> out;
  ImportFiles::Statement rows{db, "SELECT * FROM autofill_profiles ORDER BY rowid"};
  int step = SQLITE_ROW;
  while ((step = Step(rows)) == SQLITE_ROW) {
    sqlite3_stmt *row = rows.Get();
    int guidColumn = ImportFiles::ColumnIndex(row, "guid");
    if (guidColumn < 0 || sqlite3_column_type(row, guidColumn) == SQLITE_NULL) continue;
    std::string guid = ImportFiles::ColumnText(row, guidColumn);
    Text street = TextAt(row, "street_address");
    Address a;
    a.fields = {lookup(names, guid),
                TextAt(row, "company_name"),
                street ? street : Joined({TextAt(row, "address_line_1"), TextAt(row, "address_line_2")}, "\n"),
                TextAt(row, "city"),
                TextAt(row, "state"),
                TextAt(row, "zipcode"),
                Upper(TextAt(row, "country_code")),
                lookup(phones, guid),
                lookup(emails, guid)};
    out.emplace_back(guid, std::move(a));
  }
  broken.Finished(rows, step);
  return out;
}

inline bool CardDigits(std::string_view number, size_t &digits) noexcept {
  digits = 0;
  for (char c : number) {
    if (c >= '0' && c <= '9') digits++;
    else if (c != ' ' && c != '-') return false;
  }
  return digits >= 12 && digits <= 19;
}

struct Card {
  Text name;
  Text nickname;
  std::optional<int64_t> month;
  std::optional<int64_t> year;
  std::unique_ptr<Wiped> number;
};

inline void AppendAddress(Wiped &batch, Address const &address) {
  std::string out = "{";
  bool first = true;
  for (size_t i = 0; i < kAddressKeys.size(); i++) {
    if (!address.fields[i]) continue;
    if (!first) out.push_back(',');
    first = false;
    ImportFiles::AppendJsonString(out, kAddressKeys[i]);
    out.push_back(':');
    ImportFiles::AppendJsonString(out, *address.fields[i]);
  }
  out.push_back('}');
  batch.Append(out);
  SecureZeroMemory(out.data(), out.size());
}

inline void AppendCard(Wiped &batch, Card const &card) {
  std::string head = "{";
  if (card.name) {
    head.append("\"name\":");
    ImportFiles::AppendJsonString(head, *card.name);
    head.push_back(',');
  }
  head.append("\"number\":\"");
  batch.Append(head);
  for (char c : card.number->View())
    if (c >= '0' && c <= '9') batch.Append(reinterpret_cast<const uint8_t *>(&c), 1);
  std::string tail = "\"";
  if (card.month) tail.append(",\"expMonth\":").append(std::to_string(*card.month));
  if (card.year) tail.append(",\"expYear\":").append(std::to_string(*card.year));
  if (card.nickname) {
    tail.append(",\"nickname\":");
    ImportFiles::AppendJsonString(tail, *card.nickname);
  }
  tail.push_back('}');
  batch.Append(tail);
}

inline std::string Read(std::string const &browser, std::filesystem::path const &file, std::string const &joinToken) {
  uint64_t started = ImportSecrets::Store::Shared().Generation();
  auto key = ImportSecrets::Store::Shared().KeyFor(browser);
  std::unique_ptr<ImportSecrets::Gcm> gcm = key ? std::make_unique<ImportSecrets::Gcm>(*key) : nullptr;
  if (key) SecureZeroMemory(key->data(), key->size());
  ImportFiles::Snapshot snapshot{file};
  if (!snapshot.Db()) return "{\"failure\":" + ImportFiles::JsonString(snapshot.Failure()) + "}";
  sqlite3 *db = snapshot.Db();
  bool any = false;
  for (const char *table : {"credit_cards", "addresses", "local_addresses", "contact_info", "autofill_profiles"}) any = any || ImportFiles::TableExists(db, table);
  if (!any) return "{\"failure\":\"unreadable\"}";
  Broken broken;
  std::vector<Address> addresses;
  std::set<std::string> guids;
  auto take = [&](std::vector<std::pair<std::string, Address>> found) {
    for (auto &[guid, address] : found) {
      if (!guids.insert(guid).second || address.Empty()) continue;
      bool known = false;
      for (auto const &kept : addresses) known = known || kept == address;
      if (!known) addresses.push_back(std::move(address));
    }
  };
  for (auto [table, tokens] : std::array<std::pair<const char *, const char *>, 3>{
           {{"addresses", "address_type_tokens"}, {"local_addresses", "local_addresses_type_tokens"}, {"contact_info", "contact_info_type_tokens"}}})
    if (ImportFiles::TableExists(db, table) && ImportFiles::TableExists(db, tokens)) take(TokenAddresses(db, table, tokens, broken));
  if (ImportFiles::TableExists(db, "autofill_profiles")) take(LegacyAddresses(db, broken));
  std::vector<Card> cards;
  ImportSecrets::Counted counted;
  size_t locked = 0;
  if (ImportFiles::TableExists(db, "credit_cards")) {
    ImportFiles::Statement select{db, "SELECT * FROM credit_cards"};
    int step = SQLITE_ROW;
    while ((step = Step(select)) == SQLITE_ROW) {
      sqlite3_stmt *row = select.Get();
      int column = ImportFiles::ColumnIndex(row, "card_number_encrypted");
      auto blob = static_cast<const uint8_t *>(column >= 0 ? sqlite3_column_blob(row, column) : nullptr);
      size_t size = column >= 0 ? static_cast<size_t>(sqlite3_column_bytes(row, column)) : 0;
      if (!blob || size == 0) continue;
      bool sealed = size >= 3 && blob[0] == 'v' && blob[1] == '1' && (blob[2] == '0' || blob[2] == '1');
      if (sealed && !gcm) {
        locked++;
        continue;
      }
      auto number = std::make_unique<Wiped>();
      ImportSecrets::Opened opened = ImportSecrets::OpenValue(gcm.get(), blob, size, *number);
      counted.Note(opened);
      size_t digits = 0;
      if (opened != ImportSecrets::Opened::plain) continue;
      if (!CardDigits(number->View(), digits)) {
        counted.undecryptable++;
        continue;
      }
      Card card;
      card.number = std::move(number);
      card.name = TextAt(row, "name_on_card");
      card.nickname = TextAt(row, "nickname");
      if (auto month = ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, "expiration_month")); month && *month >= 1 && *month <= 12) card.month = month;
      if (auto year = ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, "expiration_year")); year && *year > 0) card.year = *year < 100 ? 2000 + *year : *year;
      cards.push_back(std::move(card));
    }
    broken.Finished(select, step);
  }
  if (broken.any) return "{\"failure\":\"unreadable\"}";
  std::vector<std::unique_ptr<Wiped>> batches;
  for (size_t start = 0; start < std::max(addresses.size(), cards.size()); start += kAutofillBatch) {
    auto batch = std::make_unique<Wiped>();
    batch->Append("{\"addresses\":[");
    for (size_t i = start; i < std::min(start + kAutofillBatch, addresses.size()); i++) {
      if (i > start) batch->Append(",");
      AppendAddress(*batch, addresses[i]);
    }
    batch->Append("],\"cards\":[");
    for (size_t i = start; i < std::min(start + kAutofillBatch, cards.size()); i++) {
      if (i > start) batch->Append(",");
      AppendCard(*batch, cards[i]);
    }
    ImportSecrets::CloseBatch(*batch);
    batches.push_back(std::move(batch));
  }
  std::string token;
  if (!batches.empty()) {
    token = ImportSecrets::Store::Shared().Attach(joinToken, std::move(batches), started);
    if (token.empty()) return "{\"failure\":\"cancelled\"}";
  }
  std::string out = "{\"addresses\":" + std::to_string(addresses.size()) + ",\"cards\":" + std::to_string(cards.size()) + "," + counted.Json() +
                    ",\"lockedCards\":" + std::to_string(locked);
  if (!token.empty()) out.append(",\"token\":").append(ImportFiles::JsonString(token));
  out.push_back('}');
  return out;
}

}

}
